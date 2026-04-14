import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<div>Login</div>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
