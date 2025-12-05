import { BrowserRouter, Routes, Route } from "react-router-dom";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import CallPage from "./pages/CallPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/call/:targetId" element={<CallPage />} />
      </Routes>
    </BrowserRouter>
  );
}
