import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const RANKS = ["A", "K", "Q", "J"];

/* Card component */
function Card({ c, onClick, selected, faceUp = true }) {
  if (!c) return null;
  return (
    <div
      className={`card ${selected ? "selected" : ""} ${faceUp ? "face" : "back"}`}
      onClick={() => onClick && onClick(c.id)}
    >
      {faceUp ? (
        <>
          <div className="card-top">{c.rank}</div>
          <div className="card-suit">{c.suit}</div>
          <div className="card-bottom">{c.rank}</div>
        </>
      ) : (
        <div className="card-back-center">🎭</div>
      )}
    </div>
  );
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("Guest");
  const [myId, setMyId] = useState(null);

  // Game state
  const [players, setPlayers] = useState([]);
  const [pileCount, setPileCount] = useState(0);
  const [lastClaim, setLastClaim] = useState(null);
  const [turnIndex, setTurnIndex] = useState(0);
  const [started, setStarted] = useState(false);

  // Personal state
  const [hand, setHand] = useState([]);
  const [selected, setSelected] = useState([]);
  const [claimRank, setClaimRank] = useState(RANKS[0]);
  const [customClaim, setCustomClaim] = useState("");
  const [log, setLog] = useState([]);

  const finishedAlertShown = useRef(false);

  /* ---------- SOCKET ---------- */
  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket"],
      secure: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    setSocket(s);

    s.on("connect", () => {
      setConnected(true);
      addLog("✅ Connected to server");
    });

    s.on("disconnect", () => {
      setConnected(false);
      addLog("🔌 Disconnected from server");
    });

    s.on("connect_error", (err) => {
      addLog("❌ Connection error: " + err.message);
    });

    s.on("room_state", (st) => {
      setPlayers(st.players || []);
      setPileCount(st.pileCount || 0);
      setLastClaim(st.lastClaim || null);
      setTurnIndex(st.turnIndex ?? 0);
      setStarted(Boolean(st.started));
    });

    s.on("your_hand", (h) => {
      setHand(h || []);
      setSelected([]);
    });

    // 🏁 Someone lost the game
    s.on("game_over", ({ loser, winners }) => {
      if (loser && winners) {
        alert(`💥 ${loser} lost the game!\n🏆 Winners: ${winners.join(", ")}`);
        addLog(`💥 ${loser} lost — winners: ${winners.join(", ")}`);
      }
    });

    return () => s.disconnect();
  }, []);

  /* ---------- HELPERS ---------- */
  function addLog(text) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${text}`, ...prev].slice(0, 200));
  }

  /* ---------- UI STATE ---------- */
  useEffect(() => {
    if (hand.length === 0 && started && !finishedAlertShown.current) {
      finishedAlertShown.current = true;
      alert("🎉 You’ve finished all your cards! Wait for the others to finish.");
      addLog("🎉 You finished all your cards!");
    }
  }, [hand, started]);

  /* ---------- ACTIONS ---------- */
  const createRoom = () => {
    if (!socket) return;
    socket.emit("create_room", { name }, (res) => {
      if (res?.ok) {
        setRoomId(res.roomId);
        setMyId(res.playerId);
        addLog(`Room created: ${res.roomId}`);
      } else addLog("❌ Failed to create room");
    });
  };

  const joinRoom = () => {
    if (!socket) return;
    if (!roomId) return addLog("Enter room ID to join");
    socket.emit("join_room", { roomId, name }, (res) => {
      if (res?.ok) {
        setRoomId(res.roomId);
        setMyId(res.playerId);
        addLog(`Joined room ${res.roomId}`);
      } else addLog("❌ Failed to join room");
    });
  };

  const startGame = () => {
    if (!socket || !roomId) return;
    socket.emit("start_game", { roomId });
  };

  const toggleSelect = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const playSelected = () => {
    if (!socket || !roomId) return;
    if (!selected.length) return addLog("Select at least one card");

    const claim = customClaim.trim()
      ? { claimText: customClaim.trim(), rank: null }
      : { claimText: `${selected.length} x ${claimRank}`, rank: claimRank };

    socket.emit("play_cards", { roomId, playerId: myId, cardIds: selected, claim });
    setSelected([]);
    setCustomClaim("");
    addLog(`🎴 Played ${selected.length} card(s) claiming "${claim.claimText}"`);
  };

  const callTa7chi = (claimedPlayerId) => {
    if (!socket || !roomId) return;
    socket.emit("call_bluff", { roomId, callerId: myId, claimedPlayerId });
    addLog("🔥 You called Ta7chi Fih!");
  };

  /* ---------- UI RENDER ---------- */
  const renderPlayer = (p, idx) => {
    const isMe = p.id === myId;
    const isTurn = idx === turnIndex;
    const isLastClaimant = lastClaim && lastClaim.playerId === p.id;
    return (
      <div
        key={p.id}
        className={`player-card ${isTurn ? "turn" : ""} ${isMe ? "me" : ""}`}
      >
        <div className="name">{p.name}{isMe ? " (You)" : ""}</div>
        <div className="count">{p.count} cards</div>
        {isLastClaimant && <div className="last-claim">💬 {lastClaim.claimText}</div>}
        {lastClaim && lastClaim.playerId === p.id && !isMe && (
          <button className="btn danger small" onClick={() => callTa7chi(p.id)}>
            Ta7chi Fih!
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="app">
      <header>
        <h1>Ta7chi Fih: 3ezzdine’s Edition</h1>
        <div className={`status ${connected ? "on" : "off"}`}>
          {connected ? "🟢 Connected" : "🔴 Offline"}
        </div>
      </header>

      <main>
        {/* Lobby controls */}
        <section className="lobby">
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Room ID"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player name"
          />
          <div className="btn-row">
            <button onClick={createRoom}>Create Room</button>
            <button onClick={joinRoom}>Join Room</button>
            <button onClick={startGame}>Start Game</button>
          </div>
        </section>

        {/* Game Table */}
        <section className="table">
          <div className="players">{players.map(renderPlayer)}</div>

          <div className="pile">
            <div className="pile-count">Pile: {pileCount}</div>
            <div className="last">{lastClaim ? `Last: ${lastClaim.claimText}` : "No claim yet"}</div>
          </div>

          <div className="hand-section">
            <div className="hand-title">Your Hand ({hand.length})</div>
            <div className="hand">
              {hand.map((c) => (
                <Card
                  key={c.id}
                  c={c}
                  onClick={toggleSelect}
                  selected={selected.includes(c.id)}
                />
              ))}
            </div>

            <div className="actions">
              <select value={claimRank} onChange={(e) => setClaimRank(e.target.value)}>
                {RANKS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <input
                placeholder="Custom claim (e.g. 2 Kings)"
                value={customClaim}
                onChange={(e) => setCustomClaim(e.target.value)}
              />
              <button onClick={playSelected} className="btn primary">Play</button>
              <button onClick={() => setSelected([])}>Clear</button>
              {lastClaim && lastClaim.playerId !== myId && (
                <button className="btn danger" onClick={() => callTa7chi(lastClaim.playerId)}>
                  Ta7chi!
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Log */}
        <section className="log">
          <h3>Activity Log</h3>
          <div className="log-box">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <small>Server: {SERVER_URL}</small>
      </footer>
    </div>
  );
}
