const express = require('express')
const { ExpressPeerServer } = require('peer');

console.log('running server');

const PORT = process.env.PORT || 3000;
const INDEX = '/index.html';
const app = express()
            .use((req, res) => res.sendFile(INDEX, { root: __dirname + "/public"}));
const server = require('http').Server(app)
const io = require('socket.io')(server, {
    cors: {
      origin: '*',
    }
  });


const peerServer = ExpressPeerServer(server, {
    path: '/'
});
app.use('/', peerServer);

const { v4: uuidv4 } = require('uuid');

let rooms = new Map();
//npmrooms.set('test', {psw:null, users: []})

/*
##
#####
##########
check if callback is not undefiened and a function
###########
#####
##
*/

function isValidRoomName(roomName) {
    return roomName !== null 
            && roomName.length >= 4 && roomName.length <= 10
            && !(/\s/.test(roomName));
}

io.on('connection', socket => {
    let userId = socket.id; //uuidv4();
    let roomId = null;
    let clientName = null;

    console.log('Client connected ' + userId);

    //send client his id
    let msg = {
        clientId: userId,
    };

    socket.emit("connected", JSON.stringify(msg));

    socket.on('check-room-valid', (roomName, callback) => {
        //callback (valid, exists, error, pswRequired)
        //room name has white space
        if (!isValidRoomName(roomName)) {
            // It has any kind of whitespace
            callback(false, null, 'Invalid room name', null);
            return;
        }

        const r = rooms.get(roomName);
        if(!r) {
            callback(true, false, null, null);
            return;
        }

        callback(true, true, null, r.psw !== null);
    })

    socket.on('has-room-permission', (roomName, psw, callback) => {
        const r = rooms.get(roomName);
        
        if(!r) {
            callback(false, 'Room does not exists');
            return;
        }

        if(r.psw !== null && r.psw !== psw) {
            callback(false, 'Wrong password');
            return;
        }

        callback(true, null);
    });




    socket.on('join-room', (userName, roomName, psw, callback) => {
        console.log('try join room: <' + userName + ">")
        //check username
        if (!(userName.length >= 4 && userName.length <= 10) || /\s/.test(userName)) {
            callback(false, false, 'Invalid username (min 4-10 characters, no white-spaces)', null);
            return;
        }

        //check room exists
        const r = rooms.get(roomName);
        if(!r) {
            callback(false, null, 'Room does not exists', null);
            return;
        }

        if(r.psw !== null && r.psw !== psw) {
            callback(false, null, 'Wrong password', null);
            return;
        }

        //add user to room
        clientName = userName;
        roomId = roomName;
        socket.join(roomId);
        //check if user got already pushed
        let members = r.users;
        let contains = false;
        for(var member in members) {
            if(member.id === userId) {
                contains = true;
                break;
            }
        }
        //user is not in the list yet, add user
        if(!contains)
            r.users.push({id: userId, name: clientName});

        console.log('send to room ' + roomId);
        //notify others
        socket.broadcast.to(roomId).emit('user-joined', JSON.stringify({id: userId, name: clientName}));

        callback(true, true, null, r.users);
    });

    socket.on('create-room', (roomName, psw, callback) => {
        console.log('#### yo create the room');
        if (!isValidRoomName(roomName)) {
            // It has any kind of whitespace
            callback(true, 'Invalid room name');
            return;
        }

        psw = psw.trim();
        
        rooms.set(roomName, { psw: psw === "" ? null : psw, users: [] });

        callback(false);
    });

    socket.on('message', msg => {
        console.log('send message from ' + clientName)
        let data = {
            id: uuidv4(),
            clientId: userId,
            clientName: clientName,
            msg: msg
        }
        io.to(roomId).emit("user_message", JSON.stringify(data));
    })

    socket.on('video-data-update', data => {
        console.log('update video: ' + data);
        if(JSON.parse(data).type === "video") {
            io.to(roomId+"-joining").emit("video-data-update", data);
        } else {
            io.to(roomId+"-joined").emit("video-data-update", data);
        }
        
    });

    socket.on('video-data-update-to', data => {
        let msg = JSON.parse(data);
        console.log('to specific client data: ' + msg.toClientId);
        console.log(data);

        io.sockets.sockets.get(msg.toClientId).emit('video-data-update', data);
    });

    socket.on('get-video', () => {
        console.log('get video data: ' + userId + " / " + roomId);
        socket.join(roomId+"-joining");

        const clients = io.sockets.adapter.rooms.get(roomId+"-joined");
        const numClients = clients ? clients.size : 0;

        if(numClients === 0) {
            //only me in room, send default data
            socket.emit('video-data-update', JSON.stringify({
                type: 'video',
                videoId: 'MDlx9k0PCSM',
                clientId: userId,
            }));
        } else {
            console.log('ask existing client for data');
            //get clientId of other client
            for (const cId of clients ) {
                if(cId !== userId) {
                    console.log('asked: ' + cId);
                    io.sockets.sockets.get(cId).emit('share-video-with', userId);
                    break;
                }
            }
        }
    });

    socket.on('get-video-state', () => {
        socket.join(roomId+"-joined");

        const clients = io.sockets.adapter.rooms.get(roomId+"-joined");
        const numClients = clients ? clients.size : 0;

        if(numClients === 1) {
            //only me in room, send default data
            socket.emit('video-data-update', JSON.stringify({
                type: 'video-state',
                state: 1,
                currentTime: 0,
                clientId: userId,
            }));
        } else {
            console.log('ask existing client for data');
            //get clientId of other client
            for (const cId of clients ) {
                if(cId !== userId) {
                    io.sockets.sockets.get(cId).emit('share-video-state-with', userId);
                    break;
                }
            }
        }
    });

    /////////////// CAMERA ////////////////////////

    socket.on('join-cam-room', (userId) => {
        console.log('user ' + userId + ' joins cam room');
        //notify others
        socket.broadcast.to(roomId).emit('user-joined-cam-room', userId);
    });


    /////////////// DISCONNECT ////////////////////////

    socket.on('disconnect', function () {
        console.log('user ' + userId + " disconnected");

        const r = rooms.get(roomId);
        if(r) {
            r.users = r.users.filter(user => user.id != userId);
            //if empty, delete room
            if(r.users.length === 0)
                rooms.delete(roomId);
        }

        socket.broadcast.to(roomId).emit('user-disconnected', 
                            JSON.stringify({id: userId, name: clientName}))
    });

});

server.listen(PORT, () => console.log(`Listening on ${PORT}`));
