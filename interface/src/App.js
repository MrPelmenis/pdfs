import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import SearchPage from "./pages/SearchPage";
import UploadPage from "./pages/UploadPage";
import ChatPage from "./pages/ChatPage";
import "./index.css";

function App() {
  return (
    <BrowserRouter>
      <Header />
      <Routes>
        <Route path="/" element={<Navigate to="/search" replace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/chat" element={<ChatPage/>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
