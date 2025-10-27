import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const RANKS = ["A", "J", "Q", "K"];

function Card({ c, onClick, selected, faceUp = true }) {
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

  // game state
  const [players, setPlayers] = useState([]);
  const [pileCount, setPileCount] = useState(0);
  const [lastClaim, setLastClaim] = useState(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [started, setStarted] = useState(false);

  const [hand, setHand] = useState([]);
  const [selected, setSelected] = useState([]);
  const [claimRank, setClaimRank] = useState(RANKS[0]);
  const [customClaim, setCustomClaim] = useState("");
  const [log, setLog] = useState([]);
  const [finishedMsg, setFinishedMsg] = useState("");
  const [loserMsg, setLoserMsg] = useState("");

  const socketRef = useRef(null);

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => addLog("Connected to server"));
    s.on("disconnect", () => addLog("Disconnected"));
    s.on("room_state", (st) => {
      setPlayers(st.players || []);
      setPileCount(st.pileCount || 0);
      setLastClaim(st.lastClaim || null);
      setTurnIndex(typeof st.turnIndex === "number" ? st.turnIndex : 0);
      setStarted(Boolean(st.started));

      // Check if current player has finished hand
      const me = st.players.find(p => p.id === myId);
      if (me && me.count === 0) setFinishedMsg("You finished your hand! Waiting for others...");
      else setFinishedMsg("");
    });
    s.on("your_hand", (h) => { setHand(h || []); setSelected([]); });
    s.on("game_over", (data) => { if (data.loserId === myId) setLoserMsg("You lost! 😢"); else setLoserMsg(`${data.loserName} lost!`); });

    return () => s.disconnect();
  }, [myId]);

  function addLog(t) {
    setLog(l => [`${new Date().toLocaleTimeString()} — ${t}`, ...l].slice(0, 200));
  }

  function createRoom() {
    socketRef.current?.emit("create_room", { roomId: roomId || undefined, name }, (res) => {
      if (res?.ok) { setRoomId(res.roomId); setMyId(res.playerId); addLog(`Created room ${res.roomId}`); }
      else addLog("Create room failed: " + (res?.error || "unknown"));
    });
  }

  function joinRoom() {
    if (!roomId) return addLog("Enter room ID to join");
    socketRef.current?.emit("join_room", { roomId, name }, (res) => {
      if (res?.ok) { setRoomId(res.roomId); setMyId(res.playerId); addLog(`Joined room ${res.roomId}`); }
      else addLog("Join failed: " + (res?.error || "unknown"));
    });
  }

  function startGame() {
    socketRef.current?.emit("start_game", { roomId }, (res) => { if (res?.ok) addLog("Game started"); else addLog("Start failed: " + (res?.error || "")); });
  }

  function toggleSelect(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]); }

  function playSelected() {
    if (!started || !selected.length || !myId) return;
    const claim = customClaim.trim() ? { claimText: customClaim.trim(), rank: null } : { claimText: `${selected.length} x ${claimRank}`, rank: claimRank };
    socketRef.current.emit("play_cards", { roomId, playerId: myId, cardIds: selected, claim });
    addLog(`Played ${selected.length} card(s) claiming "${claim.claimText}"`);
    setSelected([]); setCustomClaim("");
  }

  function callTa7chi(claimedPlayerId) {
    if (!lastClaim) return addLog("No claim to call");
    socketRef.current.emit("call_bluff", { roomId, callerId: myId, claimedPlayerId }, (res) => {
      if (res?.ok) addLog("Call result: " + JSON.stringify(res.result));
      else addLog("Call failed: " + (res?.error || ""));
    });
  }

  function renderPlayerPanel(p, idx) {
    const isMe = p.id === myId;
    const isTurn = idx === turnIndex;
    const isLastClaimant = lastClaim && lastClaim.playerId === p.id;
    return (
      <div key={p.id} className={`player-panel ${isTurn ? "active-turn" : ""} ${isMe ? "me" : ""}`}>
        <div className="player-name">{p.name}{isMe ? " (you)" : ""}</div>
        <div className="player-count">{p.count} cards</div>
        {isLastClaimant && <div className="player-claim">Last: {lastClaim.claimText}</div>}
        {(!isMe && isLastClaimant) && <button className="btn small danger" onClick={() => callTa7chi(p.id)}>Ta7chi!</button>}
      </div>
    );
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <h1>Ta7chi Fih — 3ezzdine's Edition</h1>
        <div className={`dot ${connected ? "online" : "offline"}`}></div>
      </header>

      <div className="game-container">
        <aside className="controls-lobby">
          <div className="card-panel">
            <label>Room ID</label>
            <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Leave empty to generate" />
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} />
            <button className="btn" onClick={createRoom}>Create Room</button>
            <button className="btn" onClick={joinRoom}>Join Room</button>
            <button className="btn outline" onClick={startGame} disabled={!roomId}>Start Game</button>
            <div className="muted">{finishedMsg}</div>
            <div className="muted">{loserMsg}</div>
          </div>
          <div className="log-box">
            {log.map((l,i) => <div key={i} className="log-row">{l}</div>)}
          </div>
        </aside>

        <main className="table-surface">
          <div className="table-top-players">{players.slice(1,3).map(renderPlayerPanel)}</div>
          <div className="table-center">
            <div className="pile-stack">
              {Array.from({length: Math.min(6, pileCount)}).map((_,i) => <Card key={i} c={{rank:'',suit:''}} faceUp={false} />)}
            </div>
            <div className="last-claim">{lastClaim ? lastClaim.claimText : "No claim yet"}</div>
          </div>
          <div className="table-bottom-players">{players.slice(3).map(renderPlayerPanel)}</div>
          <div className="hand-row">
            {hand.map(c => <Card key={c.id} c={c} faceUp selected={selected.includes(c.id)} onClick={toggleSelect} />)}
          </div>
          <div className="action-buttons">
            <button className="btn primary" onClick={playSelected} disabled={!started || players[turnIndex]?.id !== myId}>Play Selected</button>
            <button className="btn" onClick={() => setSelected([])}>Clear</button>
            {lastClaim && lastClaim.playerId !== myId && <button className="btn danger" onClick={() => callTa7chi(lastClaim.playerId)}>Call Ta7chi!</button>}
          </div>
        </main>
      </div>
    </div>
  );
}
