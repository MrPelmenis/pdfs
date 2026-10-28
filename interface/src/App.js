import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import SearchPage from "./pages/SearchPage";
import UploadPage from "./pages/UploadPage";
import ChatPage from "./pages/ChatPage";
import "./index.css";

function App() {
  return (
    <BrowserRouter>
      <div className="h-screen supports-[height:100dvh]:h-dvh flex flex-col overflow-hidden">
        <Header />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/search" replace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/chat" element={<ChatPage/>} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
