import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Home from "@/pages/Home";
import AssistantPage from "@/pages/AssistantPage";
import VideoGenerator from "@/pages/VideoGenerator";
import RemoveBg from "@/pages/RemoveBg";
import ImageComposer from "@/pages/ImageComposer";
import OcrPage from "@/pages/OcrPage";
import Ecommerce from "@/pages/Ecommerce";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";

/** 路由守卫：未登录重定向到登录页 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-gray-400 text-lg">加载中...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><AssistantPage /></ProtectedRoute>} />
      <Route path="/generate" element={<ProtectedRoute><Home /></ProtectedRoute>} />
      <Route path="/assistant" element={<ProtectedRoute><AssistantPage /></ProtectedRoute>} />
      <Route path="/video" element={<ProtectedRoute><VideoGenerator /></ProtectedRoute>} />
      <Route path="/remove-bg" element={<ProtectedRoute><RemoveBg /></ProtectedRoute>} />
      <Route path="/ocr" element={<ProtectedRoute><OcrPage /></ProtectedRoute>} />
      <Route path="/ecommerce" element={<ProtectedRoute><Ecommerce /></ProtectedRoute>} />
      <Route path="/compose" element={<ProtectedRoute><ImageComposer /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
