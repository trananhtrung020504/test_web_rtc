import React, { useEffect, useState } from "react";
import { socket } from "../socket";
import { useNavigate } from "react-router-dom";

export default function HomePage() {
  const [users, setUsers] = useState([]);
  const [incoming, setIncoming] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    socket.emit("get-users");

    socket.on("users", (list) => {
      setUsers(list.filter((u) => u.id !== socket.id));
    });

    socket.on("incoming-call", ({ from, name }) => {
      setIncoming({ from, name });
    });

    socket.on("call-answered", ({ accept, answerId }) => {
      if (!accept) {
        alert("Người nhận từ chối");
      } else {
        navigate(`/call/${answerId}`);
      }
    });

    return () => {
      socket.off("users");
      socket.off("incoming-call");
      socket.off("call-answered");
    };
  }, []);

  const callUser = (id) => {
    socket.emit("call-user", { targetId: id });
  };

  const answer = (accept) => {
    socket.emit("answer-call", {
      callerId: incoming.from,
      accept,
    });
    if (accept) navigate(`/call/${incoming.from}`);
    setIncoming(null);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Người đang online</h2>
      {users.map((u) => (
        <div key={u.id} style={{ marginBottom: 10 }}>
          {u.name}
          <button onClick={() => callUser(u.id)}>Call</button>
        </div>
      ))}

      {incoming && (
        <div style={{ marginTop: 40, background: "#eee", padding: 20 }}>
          <h3>Cuộc gọi đến từ {incoming.name}</h3>
          <button onClick={() => answer(true)}>Trả lời</button>
          <button onClick={() => answer(false)}>Từ chối</button>
        </div>
      )}
    </div>
  );
}

