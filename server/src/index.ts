import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import { RoomManager } from './rooms/roomManager';

const port = Number(process.env.PORT ?? 3000);
const corsOrigin = process.env.CORS_ORIGIN ?? '*';

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const staticPath = path.resolve(__dirname, '../../client/dist');
if (existsSync(staticPath)) {
  app.use(express.static(staticPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io')) {
      next();
      return;
    }

    res.sendFile(path.join(staticPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.status(200).json({
      message: 'Backend activo en modo desarrollo.',
      ui: 'Abre el cliente en http://localhost:5173'
    });
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager(io);

io.on('connection', (socket) => {
  roomManager.registerSocket(socket);
});

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on :${port}`);
});
