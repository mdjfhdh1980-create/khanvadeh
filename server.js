const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const app=express();
const server=http.createServer(app);
const io=new Server(server);
const PORT=process.env.PORT||3000;
const DB=path.join(__dirname,'data.json');
const onlineUsers=new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

function db(){try{return JSON.parse(fs.readFileSync(DB,'utf8'))}catch{return {users:[],messages:[]}}}
function save(x){fs.writeFileSync(DB,JSON.stringify(x,null,2))}
function hash(x){return crypto.createHash('sha256').update(String(x)).digest('hex')}
function token(){return crypto.randomBytes(24).toString('hex')}
function emitPresence(){
  const users=[...onlineUsers.values()].map(({id,name,username})=>({id,name,username}));
  io.to('family').emit('presence', users);
}

app.post('/api/register',(req,res)=>{
  const {name,username,password}=req.body||{};
  if(!name||!username||!password)return res.status(400).json({error:'همه موارد را پر کنید'});
  const d=db(),u=username.trim().toLowerCase();
  if(d.users.some(x=>x.username===u))return res.status(409).json({error:'این نام کاربری قبلاً استفاده شده'});
  const user={id:crypto.randomUUID(),name:name.trim(),username:u,password:hash(password),token:token()};
  d.users.push(user);save(d);
  res.json({token:user.token,user:{id:user.id,name:user.name,username:user.username}});
});
app.post('/api/login',(req,res)=>{
  const d=db(),u=String(req.body?.username||'').trim().toLowerCase();
  const user=d.users.find(x=>x.username===u&&x.password===hash(req.body?.password||''));
  if(!user)return res.status(401).json({error:'نام کاربری یا رمز عبور اشتباه است'});
  user.token=token();save(d);
  res.json({token:user.token,user:{id:user.id,name:user.name,username:user.username}});
});
function auth(req,res,next){
  const u=db().users.find(x=>x.token===req.headers.authorization);
  if(!u)return res.status(401).json({error:'ورود لازم است'});
  req.user=u;next();
}
app.get('/api/me',auth,(req,res)=>res.json({id:req.user.id,name:req.user.name,username:req.user.username}));
app.get('/api/messages',auth,(req,res)=>res.json(db().messages.slice(-300)));

io.use((socket,next)=>{
  const u=db().users.find(x=>x.token===socket.handshake.auth?.token);
  if(!u)return next(new Error('احراز هویت ناموفق'));
  socket.user=u;next();
});
io.on('connection',socket=>{
  socket.join('family');
  onlineUsers.set(socket.user.id,{id:socket.user.id,name:socket.user.name,username:socket.user.username});
  emitPresence();

  socket.on('disconnect',()=>{
    onlineUsers.delete(socket.user.id);
    emitPresence();
  });

  socket.on('sendMessage',text=>{
   text=String(text||'').trim();
   if(!text||text.length>2000)return;
   const d=db(),m={id:crypto.randomUUID(),userId:socket.user.id,name:socket.user.name,text,createdAt:new Date().toISOString()};
   d.messages.push(m);save(d);io.to('family').emit('newMessage',m);
  });
});
server.listen(PORT,()=>console.log('Khanvadeh running on '+PORT));
