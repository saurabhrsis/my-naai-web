const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require('path');
const dotenv = require("dotenv");
const helmet = require('helmet');
const { closeConnection, connectDb } = require("./src/database/config/db");
const db = require("./src/database/models");
const routes = require("./src/routes/routes");
const errorHandler = require("./src/utils/middleware/error.middleware");
const fs = require('fs');
const sendPushNotification = require("./src/firebase/sendNotification");
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const PORT = process.env.PORT || 8000;


const app = express();
// Create HTTP server
const server = http.createServer(app);
// Create Socket.io server
const io = new Server(server, {
    cors: {
        origin: "*",
    }
});

// socket connection
io.on("connection", (socket) => {
    console.log("🟢 Socket connected:", socket.id);

    // Join salon room
    socket.on("join_salon", (salonId) => {
        socket.join(`salon_${salonId}`);
        console.log(`🏪 Salon joined room: salon_${salonId}`);
    });

    //User Join Private Room
    socket.on("join_user", (userId) => {
        if (userId) {
           const room=`user_${userId}`;
           socket.join(room);
           console.log(`👤 User joined room: ${room}`);
        }
    });
    socket.on("disconnect", () => {
        console.log("🔴 Socket disconnected:", socket.id);
    });
});

// make io available in controllers
app.use((req, res, next) => {
    req.io = io;
    next();
});
// Middleware
app.use(cors({ origin: "*" }));
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
    })
)
app.use(morgan("dev"));
// `verify` keeps the raw body bytes on the request — the Razorpay webhook
// verifies its HMAC-SHA256 signature over the exact bytes it received, and a
// re-serialised parsed body is not byte-identical.
app.use(express.json({ limit: "50mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ limit:"50mb", extended: true }));




// public directory path
const publicDir = path.join(__dirname, 'public');

// uploads directory path (inside public)
const uploadsDir = path.join(publicDir, 'uploads');

// create public folder if not exists
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
    console.log('📁 public directory created');
}

// create uploads folder if not exists
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('📁 uploads directory created inside public');
}


app.use("/getFiles", express.static(path.join(__dirname, ""), {
    setHeaders: (res) => {
        res.set("Access-Control-Allow-Origin", "*")
    }
}));

// Routes
app.use("/api", routes);
app.get("/", (request, response) => {
    response.status(200).json({
        message: "MYNAAI.IN backend is running 🏃‍♂️🏃‍♂️",
    });
});

// Test database & models
app.get("/test-db", async (req, res) => {
    try {
        await db.sequelize.authenticate();

        const ignoredModels = ["Admin"];

        for (const [modelName, model] of Object.entries(db.sequelize.models)) {
            if (ignoredModels.includes(modelName)) {
                console.log(`Skipping table sync: ${modelName}`);
                continue;
            }

            await model.sync({ alter: true });
        }

        return res.json({
            success: true,
            message: "Database connected and tables updated successfully",
            ignoredModels,
            models: Object.keys(db.sequelize.models),
        });
    } catch (error) {
        console.error("Database update failed:", error);

        return res.status(500).json({
            success: false,
            message: "Database update failed",
            error: error.message,
        });
    }
});




// ✅ Catch-all for any method (GET, POST, PUT, DELETE, etc.)
app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

app.use(errorHandler);
// Handle shutdown gracefully by disconnecting from the database
process.on('SIGINT', async () => {
    await closeConnection()
    console.log('👋 SIGINT received, closing server gracefully');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeConnection()
    console.log('👋 SIGTERM received, closing server gracefully');
    process.exit(0);
});
// 🔥 CRON REGISTER
require('./cron/notification.cron');
require('./cron/plan-check.cron');
require('./cron/bookingCompletionCron');

//connect db
connectDb();
// sendPushNotification("fc2A21LpQ4W3IBj7ry6RyW:APA91bHexWAirHUAVKOZKqsl_BSxon1wTcvqhk40qWCWE1YGzQjdd76Q520S-zuX0rUtcNfyux60kk7GdtuNtm6H6f_G60SL4ODvKPTUbx55qBmKWtQVrjI","Test Title","This is test notification body")
// listen on PORT
// app.listen(PORT,'0.0.0.0', () => {
//     console.log(`Server is running on port ${PORT} 🏃‍♂️`);
// });

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT} 🏃‍♂️`);
});