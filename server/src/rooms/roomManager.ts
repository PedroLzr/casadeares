import type { Server, Socket } from 'socket.io';
import {
  MAX_PLAYERS_PER_ROOM,
  NAME_MAX_LEN,
  NAME_MIN_LEN
} from '../constants';
import { GameSimulation } from '../simulation/engine';
import type {
  ClassType,
  ClientCreateRoomPayload,
  ClientJoinRoomPayload,
  LobbyPlayer,
  LobbyStatePayload,
  RoomState,
  SocketErrorPayload
} from '../types';

interface Room {
  roomId: string;
  hostId: string;
  state: RoomState;
  players: Map<string, LobbyPlayer>;
  nextPlayerId: number;
  simulation: GameSimulation | null;
}

const ALLOWED_CLASSES: ClassType[] = ['sorceress', 'paladin', 'barbarian'];

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly io: Server) {}

  registerSocket(socket: Socket): void {
    socket.on('room:create', (payload: ClientCreateRoomPayload) => {
      this.handleCreateRoom(socket, payload);
    });

    socket.on('room:join', (payload: ClientJoinRoomPayload) => {
      this.handleJoinRoom(socket, payload);
    });

    socket.on('room:start', () => {
      this.handleStartRoom(socket);
    });

    socket.on('disconnect', () => {
      this.handleSocketLeave(socket.id);
    });
  }

  private handleCreateRoom(socket: Socket, payload: ClientCreateRoomPayload): void {
    const validated = this.validateIncomingPlayer(payload?.name, payload?.class);
    if (!validated) {
      this.emitError(socket, 'INVALID_PAYLOAD', 'Nombre o clase inválidos.');
      return;
    }

    this.removeFromCurrentRoom(socket);

    const roomId = this.generateRoomId();
    const now = Date.now();
    const player: LobbyPlayer = {
      socketId: socket.id,
      playerId: 1,
      name: validated.name,
      classType: validated.classType,
      joinedAt: now
    };

    const room: Room = {
      roomId,
      hostId: socket.id,
      state: 'lobby',
      players: new Map([[socket.id, player]]),
      nextPlayerId: 2,
      simulation: null
    };

    this.rooms.set(roomId, room);
    this.socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    this.broadcastLobbyState(room);
  }

  private handleJoinRoom(socket: Socket, payload: ClientJoinRoomPayload): void {
    const validated = this.validateIncomingPlayer(payload?.name, payload?.class);
    if (!validated) {
      this.emitError(socket, 'INVALID_PAYLOAD', 'Nombre o clase inválidos.');
      return;
    }

    const roomId = (payload?.roomId ?? '').trim().toUpperCase();
    const room = this.rooms.get(roomId);

    if (!room) {
      this.emitError(socket, 'ROOM_NOT_FOUND', 'La sala no existe.');
      return;
    }

    if (room.state !== 'lobby') {
      this.emitError(socket, 'ROOM_ALREADY_STARTED', 'La partida ya inició y no acepta nuevos jugadores.');
      return;
    }

    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      this.emitError(socket, 'ROOM_FULL', 'La sala está llena.');
      return;
    }

    this.removeFromCurrentRoom(socket);

    const now = Date.now();
    const player: LobbyPlayer = {
      socketId: socket.id,
      playerId: room.nextPlayerId,
      name: validated.name,
      classType: validated.classType,
      joinedAt: now
    };

    room.nextPlayerId += 1;
    room.players.set(socket.id, player);

    this.socketToRoom.set(socket.id, room.roomId);
    socket.join(room.roomId);

    this.broadcastLobbyState(room);
  }

  private handleStartRoom(socket: Socket): void {
    const room = this.getRoomBySocketId(socket.id);
    if (!room) {
      this.emitError(socket, 'ROOM_NOT_FOUND', 'No estás en ninguna sala.');
      return;
    }

    if (room.state !== 'lobby') {
      this.emitError(socket, 'ROOM_NOT_IN_LOBBY', 'La partida ya empezó o finalizó.');
      return;
    }

    if (room.hostId !== socket.id) {
      this.emitError(socket, 'NOT_HOST', 'Solo el host puede iniciar.');
      return;
    }

    if (room.players.size === 0) {
      this.emitError(socket, 'EMPTY_ROOM', 'La sala no tiene jugadores.');
      return;
    }

    room.state = 'running';

    const simulation = new GameSimulation(
      [...room.players.values()],
      (snapshot) => {
        this.io.to(room.roomId).emit('game:snapshot', snapshot);
      },
      (endPayload) => {
        room.state = 'ended';
        this.io.to(room.roomId).emit('game:end', endPayload);
      }
    );

    room.simulation = simulation;
    simulation.start();
  }

  private handleSocketLeave(socketId: string): void {
    const room = this.getRoomBySocketId(socketId);
    if (!room) {
      this.socketToRoom.delete(socketId);
      return;
    }

    this.socketToRoom.delete(socketId);

    if (room.state === 'lobby') {
      room.players.delete(socketId);
      if (room.players.size === 0) {
        this.rooms.delete(room.roomId);
        return;
      }

      if (room.hostId === socketId) {
        const nextHost = this.pickNextHost(room);
        if (nextHost) {
          room.hostId = nextHost.socketId;
        }
      }

      this.broadcastLobbyState(room);
      return;
    }

    if (room.state === 'running') {
      room.players.delete(socketId);
      room.simulation?.removePlayer(socketId);

      if (room.players.size === 0) {
        room.simulation?.stop();
        this.rooms.delete(room.roomId);
      }

      return;
    }

    room.players.delete(socketId);
    if (room.players.size === 0) {
      room.simulation?.stop();
      this.rooms.delete(room.roomId);
    }
  }

  private removeFromCurrentRoom(socket: Socket): void {
    const room = this.getRoomBySocketId(socket.id);
    if (!room) {
      return;
    }

    socket.leave(room.roomId);
    this.handleSocketLeave(socket.id);
  }

  private getRoomBySocketId(socketId: string): Room | null {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) {
      return null;
    }

    const room = this.rooms.get(roomId);
    return room ?? null;
  }

  private pickNextHost(room: Room): LobbyPlayer | null {
    const ordered = [...room.players.values()].sort((a, b) => {
      if (a.joinedAt !== b.joinedAt) {
        return a.joinedAt - b.joinedAt;
      }
      return a.playerId - b.playerId;
    });

    return ordered[0] ?? null;
  }

  private validateIncomingPlayer(nameRaw: unknown, classRaw: unknown): { name: string; classType: ClassType } | null {
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (name.length < NAME_MIN_LEN || name.length > NAME_MAX_LEN) {
      return null;
    }

    const classType = typeof classRaw === 'string' ? classRaw : '';
    if (!ALLOWED_CLASSES.includes(classType as ClassType)) {
      return null;
    }

    return {
      name,
      classType: classType as ClassType
    };
  }

  private broadcastLobbyState(room: Room): void {
    const players = [...room.players.values()].sort((a, b) => a.playerId - b.playerId);
    const payload: LobbyStatePayload = {
      roomId: room.roomId,
      hostId: room.hostId,
      players
    };

    this.io.to(room.roomId).emit('room:lobbyState', payload);
  }

  private emitError(socket: Socket, code: string, message: string): void {
    const payload: SocketErrorPayload = { code, message };
    socket.emit('error', payload);
  }

  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    while (true) {
      let roomId = '';
      for (let i = 0; i < 6; i += 1) {
        roomId += chars[Math.floor(Math.random() * chars.length)];
      }

      if (!this.rooms.has(roomId)) {
        return roomId;
      }
    }
  }
}
