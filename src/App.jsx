import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const RANKS = ["A","J","Q","K"];

/* Tiny Card component */
function Card({ c, onClick, selected, faceUp=true }) {
  if (!c) return null;
  return (
    <div
      className={`card ${selected ? "selected" : ""} ${faceUp ? "face" : "back"}`}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(c.id); }}
      role="button"
      tabIndex={0}
    >
      {faceUp ? (
        <>
          <div className="card-top">{c.rank}</div>
          <div className="card-suit">{c.suit}</div>
          <div className="card-bottom">{c.rank}</div>
        </>
      ) : (
        <div className="card-back-center">Ta7chi</div>
      )}
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  // lobby & identity
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("Guest");
  const [myId, setMyId] = useState(null);

  // game state (from server)
  const [players, setPlayers] = useState([]); // safe players: {id,name,count,isHost}
  const [pileCount, setPileCount] = useState(0);
  const [lastClaim, setLastClaim] = useState(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [started, setStarted] = useState(false);

  // private hand and UI
  const [hand, setHand] = useState([]);
  const [selected, setSelected] = useState([]);
  const [claimRank, setClaimRank] = useState(RANKS[0]);
  const [customClaim, setCustomClaim] = useState("");
  const [log, setLog] = useState([]);

  const socketRef = useRef(null);

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => { setConnected(true); addLog("Connected to server"); });
    s.on("disconnect", () => { setConnected(false); addLog("Disconnected"); });
    s.on("room_state", (st) => {
      setPlayers(st.players || []);
      setPileCount(st.pileCount || 0);
      setLastClaim(st.lastClaim || null);
      setTurnIndex(typeof st.turnIndex === "number" ? st.turnIndex : 0);
      setStarted(Boolean(st.started));
    });
    s.on("your_hand", (h) => {
      setHand(h || []);
      setSelected([]); // reset local selection on new hand
    });
    s.on("connect_error", (err) => addLog("Connection error: " + (err.message || err)));
    s.on("error", (e) => addLog("Socket error: " + JSON.stringify(e)));

    return () => s.disconnect();
  }, []);

  // small helper for logs
  function addLog(t) {
    setLog(l => [ `${new Date().toLocaleTimeString()} — ${t}`, ...l ].slice(0, 200));
  }

  // Lobby actions
  function createRoom() {
    if (!socketRef.current) return addLog("Socket not ready");
    socketRef.current.emit("create_room", { roomId: roomId || undefined, name }, (res) => {
      if (res && res.ok) {
        setRoomId(res.roomId);
        setMyId(res.playerId);
        addLog(`Created room ${res.roomId}`);
      } else {
        addLog("Create room failed: " + (res?.error || "unknown"));
      }
    });
  }
  function joinRoom() {
    if (!socketRef.current) return addLog("Socket not ready");
    if (!roomId) return addLog("Enter room ID to join");
    socketRef.current.emit("join_room", { roomId, name }, (res) => {
      if (res && res.ok) {
        setRoomId(res.roomId);
        setMyId(res.playerId);
        addLog(`Joined room ${res.roomId}`);
      } else {
        addLog("Join failed: " + (res?.error || "unknown"));
      }
    });
  }
  function startGame() {
    if (!socketRef.current) return;
    socketRef.current.emit("start_game", { roomId }, (res) => {
      if (res && res.ok) addLog("Game started");
      else addLog("Start failed: " + (res?.error || ""));
    });
  }

  // Play & call
  function toggleSelect(cardId) {
    setSelected(s => s.includes(cardId) ? s.filter(x => x !== cardId) : [...s, cardId]);
  }

  function playSelected() {
    if (!socketRef.current) return addLog("Socket not ready");
    if (!started) return addLog("Game not started");
    if (!selected.length) return addLog("Select cards to play");
    if (!myId) return addLog("Unknown player id");

    const claim = customClaim.trim()
      ? { claimText: customClaim.trim(), rank: null }
      : { claimText: `${selected.length} x ${claimRank}`, rank: claimRank };

    socketRef.current.emit("play_cards", { roomId, playerId: myId, cardIds: selected, claim });
    addLog(`Played ${selected.length} card(s) claiming "${claim.claimText}"`);
    setSelected([]);
    setCustomClaim("");
  }

  function callTa7chi(claimedPlayerId) {
    if (!socketRef.current) return addLog("Socket not ready");
    if (!lastClaim) return addLog("No claim to call");
    socketRef.current.emit("call_bluff", { roomId, callerId: myId, claimedPlayerId }, (res) => {
      if (res && res.ok) {
        addLog("Call result: " + JSON.stringify(res.result));
      } else {
        addLog("Call failed: " + (res?.error || ""));
      }
    });
  }

  // helper: find player index by id
  function playerIndexById(id) {
    return players.findIndex(p => p.id === id);
  }
  
  // Helper: advance to next active player
 function nextTurn(room) {
  const len = room.players.length;
  if(room.players.every(p => p.finished)) return; // no one left
  let idx = room.turnIndex;
  for(let i=0; i<len; i++) {
    idx = (idx + 1) % len;
    if(!room.players[idx].finished) break;
  }
  room.turnIndex = idx;
}

// Helper: check if only one active player remains
function checkLastPlayer(room, roomId) {
  const active = room.players.filter(p => !p.finished);
  if(active.length === 1) {
    const loser = active[0];
    io.to(roomId).emit('game_over', { loserId: loser.id, loserName: loser.name, message: 'YOU WERE THE LEAST 7ACHWEJI' });
    room.started = false;
  }
}

  // UI helpers: layout players around table
  function renderPlayerPanel(p, idx) {
    const isMe = p.id === myId;
    const isTurn = idx === turnIndex;
    const isLastClaimant = lastClaim && lastClaim.playerId === p.id;
    return (
      <div key={p.id} className={`player-panel ${isTurn ? "active-turn" : ""} ${isMe ? "me" : ""}`}>
        <div className="player-name">{p.name}{isMe ? " (you)" : ""}</div>
        <div className="player-count">{p.count} cards</div>
        {isLastClaimant && <div className="player-claim">Last: {lastClaim.claimText}</div>}
        <div style={{marginTop:8}}>
          { (!isMe && lastClaim && lastClaim.playerId === p.id) &&
            <button className="btn small" onClick={() => callTa7chi(p.id)}>Ta7chi Fih! (Call)</button>
          }
        </div>
      </div>
    );
  }

  // render player positions: host window arranges panels clockwise
  const playerPanels = players.map((p, i) => renderPlayerPanel(p, i));

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="title">
          <h1>Ta7chi Fih — 3ezzdine's Edition</h1>
          <div className="subtitle">Stylized table — multiplayer</div>
        </div>
        <div className="status">
          <div className={`dot ${connected ? "online" : "offline"}`}></div>
          <div className="status-text">{connected ? "online" : "offline"}</div>
        </div>
      </header>

      <main className="table-wrap">
        <section className="controls-lobby">
          <div className="card-panel">
            <label>Room ID</label>
            <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Leave empty to generate" />
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} />
            <div className="lobby-buttons">
              <button className="btn" onClick={createRoom}>Create Room</button>
              <button className="btn" onClick={joinRoom}>Join Room</button>
              <button className="btn outline" onClick={startGame} disabled={!roomId}>Start Game</button>
            </div>
            <div className="small muted">Room: <strong>{roomId || "-"}</strong></div>
          </div>

          <div className="card-panel">
            <div className="muted">Players in room</div>
            <div className="players-list">{playerPanels}</div>
            <div className="muted">Pile: {pileCount} cards</div>
            <div className="muted">Turn: {players[turnIndex]?.name || "-"}</div>
          </div>
        </section>

        <section className="table-stage">
          <div className="table-surface">
            <div className="table-top-players">
              {players.slice(1, Math.min(players.length,3)).map((p,i) => (
                <div key={p.id} className="top-player">
                  <div className="name-small">{p.name}</div>
                  <div className="back-stack"><Card faceUp={false} c={{rank:'?',suit:''}} /></div>
                </div>
              ))}
            </div>

            <div className="table-center">
              <div className="pile-visual">
                <div className="pile-stack">
                  {/* show stacked backs for the pile */}
                  {Array.from({length: Math.min(6, pileCount)}).map((_,i) => (
                    <div key={i} className="pile-card" style={{ transform: `translate(${i*2}px, -${i*2}px)` }}>
                      <Card faceUp={false} c={{rank:'',suit:''}} />
                    </div>
                  ))}
                </div>
                <div className="last-claim">{lastClaim ? `Last: ${lastClaim.claimText}` : "No claim yet"}</div>
              </div>
            </div>

            <div className="table-bottom-players">
              {/* show remaining players beyond index 2 */}
              {players.slice(3).map(p => (
                <div key={p.id} className="bottom-player">
                  <div className="name-small">{p.name}</div>
                  <div className="back-stack"><Card faceUp={false} c={{rank:'',suit:''}} /></div>
                </div>
              ))}
            </div>
          </div>

          <aside className="hand-and-actions">
            <div className="hand-wrap">
              <div className="hand-title">Your Hand ({hand.length})</div>
              <div className="hand-row">
                {hand.map(c => (
                  <div key={c.id} className="hand-card-wrap">
                    <Card c={c} selected={selected.includes(c.id)} onClick={toggleSelect} faceUp={true} />
                  </div>
                ))}
              </div>
            </div>

            <div className="actions">
              <div className="claim-row">
                <label>Claim rank</label>
                <select value={claimRank} onChange={e => setClaimRank(e.target.value)}>
                  {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <div className="muted">or custom:</div>
                <input placeholder="e.g. 2 kings" value={customClaim} onChange={e => setCustomClaim(e.target.value)} />
              </div>

              <div className="action-buttons">
                <button className="btn primary" onClick={playSelected} disabled={!started || players[turnIndex]?.id !== myId}>Play Selected</button>
                <button className="btn" onClick={() => setSelected([])}>Clear</button>
                { lastClaim && lastClaim.playerId !== myId &&
                  <button className="btn danger" onClick={() => callTa7chi(lastClaim.playerId)}>Call Ta7chi!</button>
                }
              </div>
            </div>

            <div className="log-box">
              <div className="muted">Activity</div>
              <div className="log-list">
                {log.map((l, i) => <div key={i} className="log-row">{l}</div>)}
              </div>
            </div>
          </aside>
        </section>
      </main>

      <footer className="app-footer">
        <div>Prototype — Ta7chi Fihe · server: {SERVER_URL}</div>
      </footer>
    </div>
  );
}
