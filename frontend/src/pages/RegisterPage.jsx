import React, { useState } from "react";
import { socket } from "../socket";
import { useNavigate } from "react-router-dom";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const register = () => {
    if (!name.trim()) return;
    socket.emit("register", { name });
    navigate("/home");
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Đăng ký tên</h2>
      <input
        placeholder="Tên của bạn"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button onClick={register}>Đăng ký</button>
    </div>
  );
}
