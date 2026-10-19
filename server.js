const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { users: [], messages: [] }; }
}
function save(db) { fs.writeFileSync(DATA, JSON.stringify(db, null, 2)); }
function hash(p) { return crypto.createHash("sha256").update(p).digest("hex"); }
function token() { return crypto.randomBytes(24).toString("hex"); }

app.post("/api/register", (req,res)=>{
  const {name, username, password} = req.body || {};
  if(!name || !username || !password) return res.status(400).json({error:"همه فیلدها الزامی است"});
  const db=load(), u=username.trim().toLowerCase();
  if(db.users.some(x=>x.username===u)) return res.status(409).json({error:"این نام کاربری قبلاً ثبت شده"});
  const user={id:crypto.randomUUID(),name:name.trim(),username:u,password:hash(password),token:token()};
  db.users.push(user); save(db);
  res.json({token:user.token,user:{id:user.id,name:user.name,username:user.username}});
});

app.post("/api/login", (req,res)=>{
  const {username,password}=req.body || {}, db=load(), u=(username||"").trim().toLowerCase();
  const user=db.users.find(x=>x.username===u && x.password===hash(password||""));
  if(!user) return res.status(401).json({error:"نام کاربری یا رمز عبور اشتباه است"});
  user.token=token(); save(db);
  res.json({token:user.token,user:{id:user.id,name:user.name,username:user.username}});
});

function auth(req,res,next){
  const db=load(), user=db.users.find(x=>x.token===req.headers.authorization);
  if(!user) return res.status(401).json({error:"نیاز به ورود دارید"});
  req.user=user; next();
}
app.get("/api/me",auth,(req,res)=>res.json({id:req.user.id,name:req.user.name,username:req.user.username}));

app.get("/api/messages",auth,(req,res)=>{
  const db=load();
  res.json(db.messages.slice(-300));
});

io.use((socket,next)=>{
  const db=load(), user=db.users.find(x=>x.token===socket.handshake.auth?.token);
  if(!user) return next(new Error("احراز هویت ناموفق"));
  socket.user=user; next();
});
io.on("connection",socket=>{
  socket.join("family");
  socket.emit("presence", {online:true, name:socket.user.name});
  socket.on("sendMessage", text=>{
    text=String(text||"").trim();
    if(!text || text.length>2000) return;
    const db=load();
    const msg={id:crypto.randomUUID(),userId:socket.user.id,name:socket.user.name,text,createdAt:new Date().toISOString()};
    db.messages.push(msg); save(db);
    io.to("family").emit("newMessage",msg);
  });
  socket.on("disconnect",()=>socket.broadcast.to("family").emit("presence",{online:false,name:socket.user.name}));
});

server.listen(PORT,()=>console.log(`خانواده روی http://localhost:${PORT}`));
