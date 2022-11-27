//@ts-check

const port = process.env.PORT || 8080;

const express = require('express');
const path = require('path');
const {createServer} = require('http');

const WebSocket = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, '/public')));

const server = createServer(app);
const wss = new WebSocket.Server({server});

console.log("Running now on port " + port);

/**
 * The minimum API version number the client must be running in order to connect to this server. Bump this to match
 * the earliest client version number the server can support.
 *
 * Note that this can and should frequently be much lower than the actual current API version. This should probably not
 * be bumped much at all, as server changes should be relatively rare.
 * @type {number}
 */
const MIN_API_VER = 0;

/**
 * An enumeration for the type of network packet received.
 */
const NetworkDataType = Object.freeze({
	GeneralMsg: 0,
	HostMsg: 1,
	
	PlayerJoined: 50,
	PlayerDisconnect: 51,
	StartGame: 52,
	
	AssignedRoom: 100,
	JoinRoom: 101,
	ApiMismatch: 102,
});


/**
 * The mapping from room ID to list of connections in a room
 * @type {Map<string, GameRoom>}
 */
const roomToSocket = new Map();

/**
 * The mapping from connection to room ID
 * @type {Map<WebSocket, string>}
 */
const socketToRoom = new Map();


/**
 * A room containing the number of players who should be here, as well as a list of connections.
 */
class GameRoom {
	constructor(id, max, ver) {
		/**
		 * The id of this room
		 * @type {string}
		 */
		this.ID = id;
		
		/**
		 * The maximum number of players in this room
		 * @type {number}
		 */
		this.MAX_NUM = max;
		
		/**
		 * The API version number of the host.
		 * @type {number}
		 */
		this.api = ver;
		
		/**
		 * The current connected players in this room
		 * @type {number}
		 */
		this.currNum = 0;
		
		/**
		 * The connections in this room. The game has started iff the length of this array is equal to MAX_NUM.
		 * Null entries represent players that have dropped connection.
		 * @type {(?WebSocket)[]}
		 */
		this.connections = [];
		
		roomToSocket.set(id, this);
	}
	
	/**
	 * Whether the game is full and started
	 * @returns {boolean}
	 */
	get started() {
		return this.connections.length >= this.MAX_NUM;
	}
	
	start() {
		if (this.started) {
			return;
		}
		this.MAX_NUM = this.connections.length;
	}
	
	/**
	 * Add a player to this room, as long as it is not full
	 * @param {WebSocket} ws The websocket connection
	 * @return {number} The player ID of the new player, or -1 for failure
	 */
	addPlayer(ws) {
		if (this.started) { return -1; }
		
		let newID = this.connections.indexOf(null);
		if (newID !== -1) {
			// Give new player the old hole.
			this.connections[newID] = ws;
		} else {
			newID = this.connections.length;
			this.connections.push(ws);
		}
		
		this.broadcast(ws, String.fromCharCode(NetworkDataType.PlayerJoined) + String.fromCharCode(newID));
		
		this.currNum++;
		socketToRoom.set(ws, this.ID);
		return newID;
	}
	
	/**
	 * Disconnect a player from this room. If this room is now empty, delete it.
	 * @param {WebSocket} ws The player's connection
	 */
	dropPlayer(ws) {
		const id = this.connections.indexOf(ws);
		socketToRoom.delete(ws);
		this.connections[id] = null;
		this.currNum--;
		console.log("Dropping player; new player count " + this.currNum);
		
		if (this.currNum === 0) {
			console.log("Freeing room ID " + this.ID);
			roomToSocket.delete(this.ID);
		} else {
			this.broadcast(null, String.fromCharCode(NetworkDataType.PlayerDisconnect) + String.fromCharCode(id));
		}
		
		if (id === 0) {
			console.log("Lost host; abandoning room");
			this.connections.forEach(x => {
				if (x === null) { return; }
				this.dropPlayer(x);
			})
		}
	}
	
	/**
	 * Reconnect a player to the room.
	 * @param ws
	 * @param id
	 * @returns {boolean}
	 */
	reconnectPlayer(ws, id) {
		if (this.currNum === this.MAX_NUM) { return false; }
		if (this.connections[id] !== null) { return false; }
		socketToRoom.set(ws, this.ID);
		this.connections[id] = ws;
		this.currNum++;
		this.broadcast(ws, String.fromCharCode(NetworkDataType.PlayerJoined) + String.fromCharCode(id));
		ws.send(String.fromCharCode(NetworkDataType.JoinRoom) + String.fromCharCode(3));
		return true;
	}
	
	/**
	 * Broadcast a message to all players except the one specified (presumably the sender)
	 * @param {WebSocket | null} ws The player not to send the message to (or null for everyone)
	 * @param msg The message to broadcast
	 */
	broadcast(ws, msg) {
		this.connections.forEach(x => {
			if (x !== null && x !== ws && x.readyState === WebSocket.OPEN) {
				x.send(msg);
			}
		});
	}
}

wss.on('connection', function (/** @type {WebSocket.WebSocket & {isAlive: boolean}} */ws) {
	
	ws.isAlive = true;
	ws.on('pong', () => {
		ws.isAlive = true;
	});
	
	ws.on('message', function incoming(message) {
		// @ts-ignore
		const msg = new Uint8Array(message);
		const tag = /** @type {typeof NetworkDataType[keyof typeof NetworkDataType]} */(msg[0]);
		
		switch (tag) {
			case NetworkDataType.PlayerDisconnect: {
				closeConnection(ws);
				break;
			}
			case NetworkDataType.AssignedRoom: {
				const apiVer = msg[1];
				if (apiVer < MIN_API_VER) {
					console.log("Host with outdated API " + apiVer + " tried to connect; rejecting");
					ws.send(String.fromCharCode(NetworkDataType.ApiMismatch));
					ws.close();
					break;
				}
				let roomID;
				do {
					roomID = '0' + Math.random().toString().substring(2, 6);
				} while (roomToSocket.has(roomID));
				const room = new GameRoom(roomID, 6, apiVer);
				room.addPlayer(ws);
				console.log("Assigning Room " + roomID);
				ws.send(String.fromCharCode(NetworkDataType.AssignedRoom) + roomID);
				break;
			}
			case NetworkDataType.JoinRoom: {
				// Response (bit index 1): 0 = success, 1 = no exist, 2 = full; if success, bit index 2 = # of players already
				const roomID = String.fromCharCode(msg[1]) + String.fromCharCode(msg[2]) + String.fromCharCode(msg[3]) + String.fromCharCode(msg[4]) + String.fromCharCode(msg[5]);
				console.log("Joining Room " + roomID);
				const room = roomToSocket.get(roomID);
				if (room === undefined) {
					// Room does not exist
					console.log("Room no exist");
					ws.send(String.fromCharCode(NetworkDataType.JoinRoom) + String.fromCharCode(1));
				} else if (room.started) {
					// Game has started
					if (room.currNum === room.MAX_NUM) {
						console.log("Room full");
						ws.send(String.fromCharCode(NetworkDataType.JoinRoom) + String.fromCharCode(2));
					} else {
						// Reconnection attempt
						if (!room.reconnectPlayer(ws, msg[6])) {
							ws.send(String.fromCharCode(NetworkDataType.JoinRoom) + String.fromCharCode(4));
						}
					}
				} else {
					// Join Success
					if (room.api !== msg[6]) {
						console.log("Client join with invalid API " + msg[6] + " instead of expected " + room.api);
						ws.send(String.fromCharCode(NetworkDataType.ApiMismatch));
						ws.close();
						return;
					}
					const playerID = room.addPlayer(ws);
					console.log("Success, player size " + room.connections.length);
					ws.send(
						String.fromCharCode(NetworkDataType.JoinRoom) +
						String.fromCharCode(0) +
						String.fromCharCode(room.currNum) +
						String.fromCharCode(playerID)
					);
				}
				break;
			}
			case NetworkDataType.StartGame:
			case NetworkDataType.GeneralMsg:
			case NetworkDataType.HostMsg: {
					const roomID = socketToRoom.get(ws);
					if (!roomID) {
						console.error("ERROR: Received message from unrecognzied socket");
						break;
					}
					const room = roomToSocket.get(roomID);
					if (room) {
						if (msg[0] === NetworkDataType.StartGame) {
							room.start();
						}
						
						if (msg[0] !== NetworkDataType.HostMsg) {
							room.broadcast(ws, message);
						} else {
							room.connections[0]?.send(message);
						}
					} else {
						console.error("ERROR: Received message for invalid roomID: " + roomID);
					}
					break;
				}
			case NetworkDataType.PlayerJoined:
			case NetworkDataType.ApiMismatch:
				console.error(`Received invalid msg on server ${tag}`);
				break;
			default: {
				(/** @param {never} x */(x) => {throw new Error(x);})(tag);
			}
		}
	});
	
	ws.on("close", () => {
		closeConnection(ws);
	});
});

function closeConnection(ws) {
	const roomID = socketToRoom.get(ws);
	ws.terminate();
	if (!roomID) { return; }
	
	const room = roomToSocket.get(roomID);
	if (!room) { return; }
	room.dropPlayer(ws);
}

setInterval(function () {
	/** @type {Set<WebSocket.WebSocket & {isAlive: boolean}>} */(wss.clients).forEach(ws => {
		if (ws.isAlive === false) {
			closeConnection(ws);
			return;
		}
		ws.isAlive = false;
		ws.ping(() => {});
	});
}, 10000);

server.listen(port, function () {
	console.log('Listening on http://localhost:' + port);
});