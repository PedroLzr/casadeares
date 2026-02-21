# Autobattler Monorepo (Node + TS + Vite + Phaser + Socket.io)

Monorepo con backend autoritativo y frontend de render:

- `server`: Node.js + TypeScript + Express + Socket.io
- `client`: Vite + TypeScript + Phaser 3

El gameplay se simula 100% en servidor (sin inputs durante partida).

## Características implementadas

- Home: crear sala o unirse por `roomId`
- Validación de nombre: mínimo 3, máximo 16
- Lobby: lista de jugadores conectados y host con botón `Start`
- Host dinámico en lobby: si el host sale, pasa al segundo en entrar
- Inicio de partida: bloqueo de nuevos joins al arrancar
- Simulación servidor 20 TPS, snapshots completos a 10Hz
- Interpolación cliente lineal con buffer fijo 100ms
- IA: movimiento errático, targeting por menor vida -> distancia -> menor `playerId`
- Ataques simultáneos por tick (cola de daño)
- Meteoritos y fuego con áreas/daño exactos
- Habilidades:
  - Hechicera: teletransporte tras 1s continuo en fuego (1 vez)
  - Paladín: curación a 80% al caer por primera vez a <=20% (1 vez)
  - Bárbaro: escudo 50% al recibir daño por primera vez (1 vez)
- Resultado final con ranking top3 y empates por posición (incluye empate en 1º)
- Spatial hash/grid buckets para evitar `O(n^2)` en vecinos/target/colisión

## Estructura

```text
.
├── client
│   ├── src
│   │   ├── game
│   │   │   ├── GameRenderer.ts
│   │   │   └── GameScene.ts
│   │   ├── main.ts
│   │   ├── styles.css
│   │   └── types.ts
│   ├── Dockerfile.dev
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── server
│   ├── src
│   │   ├── rooms
│   │   │   └── roomManager.ts
│   │   ├── simulation
│   │   │   ├── engine.ts
│   │   │   └── spatialHash.ts
│   │   ├── constants.ts
│   │   ├── index.ts
│   │   └── types.ts
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── package.json
└── tsconfig.base.json
```

## WebSocket events

Cliente -> servidor:

- `room:create { name, class }`
- `room:join { roomId, name, class }`
- `room:start`

Servidor -> cliente:

- `room:lobbyState { roomId, hostId, players[] }`
- `game:snapshot { t, tick, players[], hazards[], map }`
- `game:end { results[] }`
- `error { code, message }`

## Reglas numéricas

Escala x100 (sin decimales):

- Vida máxima: `10000`
- Golpe: `500`
- Meteorito: `2500`
- Fuego: `500/s` => `25` por tick (20 TPS)
- Cooldown ataque: `40 ticks` (2s)

## Desarrollo con Docker

Requisitos:

- Docker + Docker Compose

Arrancar:

```bash
npm run docker:dev
```

Servicios:

- Client (Vite): `http://localhost:5173`
- Server (API/Socket): `http://localhost:3000`

## Producción con Docker Compose

```bash
npm run docker:prod
```

Servicios:

- Client (preview build): `http://localhost:5173`
- Server (API/Socket): `http://localhost:3000`

Opcional: definir `VITE_SERVER_URL` al levantar producción si no usarás `localhost`.

## Desarrollo local sin Docker

```bash
npm install
npm run dev:server
npm run dev:client
```

## Notas de arquitectura

- El server es autoritativo: movimiento, targeting, daño, hazards y fin de partida.
- El cliente no manda inputs de gameplay durante combate.
- Render Phaser + overlays DOM para Home/Lobby/End.
- Colisión implementada manualmente (paredes + separación suave jugador-jugador).
