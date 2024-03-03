const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = 5000;
const BACKEND_URL = 'http://localhost:8050'; // Replace this with your backend URL

// Use cors middleware to handle CORS headers
app.use(cors());

// Proxy all requests to the backend
app.use('/', createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
}));

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
