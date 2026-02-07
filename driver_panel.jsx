import React, { useState, useEffect, useRef } from 'react';
import { 
  Trophy, Flag, AlertCircle, MessageSquare, User, Users, 
  LayoutDashboard, Gavel, CheckCircle, XCircle, Send, 
  ExternalLink, Shield, Plus, History, LogOut, Database, 
  RefreshCw, Settings, Save, Lock, Mail, Key, Chrome, AlertTriangle, Info
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, 
  getDoc, onSnapshot, query, serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, onAuthStateChanged, 
  signInWithCustomToken, GoogleAuthProvider, signInWithPopup, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword
} from 'firebase/auth';

// --- FIREBASE CONFIG (Connected to ttrl-9f3ef) ---
const firebaseConfig = {
  apiKey: "AIzaSyApUD33ao9DfFa8IAfA2qby3IFKhLtcNFU",
  authDomain: "ttrl-9f3ef.firebaseapp.com",
  projectId: "ttrl-9f3ef",
  storageBucket: "ttrl-9f3ef.firebasestorage.app",
  messagingSenderId: "51144639440",
  appId: "1:51144639440:web:8a027b773bc2cddefe2fd5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- COMPONENTS ---
const Card = ({ children, className = "" }) => (
  <div className={`bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden shadow-sm ${className}`}>
    {children}
  </div>
);

const Badge = ({ status }) => {
  const styles = {
    Open: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    Investigating: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Closed: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return <span className={`px-2 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.Open}`}>{status}</span>;
};

export default function RacingApp() {
  const [user, setUser] = useState(null); // Auth user
  const [profile, setProfile] = useState(null); // User Profile (Name, SteamID)
  const [role, setRole] = useState('guest'); // guest, driver, steward
  
  const [view, setView] = useState('loading');
  const [drivers, setDrivers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [tickets, setTickets] = useState([]);
  
  // Auth State
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authError, setAuthError] = useState(null);

  // Forms
  const [onboardData, setOnboardData] = useState({ name: '', steamId: '', eaId: '' });
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [newTicket, setNewTicket] = useState({ accusedId: '', session: 'Race', lap: '', description: '', evidence: '' });
  const [chatMessage, setChatMessage] = useState("");
  const messagesEndRef = useRef(null);

  // --- AUTH INITIALIZATION ---
  useEffect(() => {
    // Standard Firebase Auth Listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        await checkUserProfile(firebaseUser);
      } else {
        setUser(null);
        setView('login');
      }
    });
    return () => unsubscribe();
  }, []);

  // --- CORE LOGIC: ROLES & PERMISSIONS ---
  const checkUserProfile = async (firebaseUser) => {
    try {
      const email = firebaseUser.email;
      if (!email) { setView('login'); return; }

      // 1. Determine Role via Admin/Driver_permissions collections
      let assignedRole = 'driver';
      
      // Check Admin Collection
      try {
        const adminSnap = await getDoc(doc(db, 'Admin', email));
        if (adminSnap.exists() && adminSnap.data().admin === true) {
          assignedRole = 'steward';
        }
      } catch (e) { console.log("Not admin check skipped"); }

      // Check Steward Permission (if not already admin)
      if (assignedRole !== 'steward') {
        try {
          const permSnap = await getDoc(doc(db, 'Driver_permissions', email));
          if (permSnap.exists() && permSnap.data().steward === true) {
            assignedRole = 'steward';
          }
        } catch (e) { console.log("Not steward check skipped"); }
      }
      setRole(assignedRole);

      // 2. Fetch User Profile (Name, SteamID)
      // We use a dedicated 'profiles' collection for user details to avoid permission lockouts
      const profileRef = doc(db, 'profiles', email);
      const profileSnap = await getDoc(profileRef);

      if (profileSnap.exists()) {
        setProfile(profileSnap.data());
        setView('dashboard');
      } else {
        setView('onboarding');
      }
    } catch (error) {
      console.error("Profile check failed:", error);
      // Even if profile check fails (e.g. network), try to let them login to see error
      setView('login');
    }
  };

  // --- DATA FETCHING ---
  useEffect(() => {
    if (view === 'login' || view === 'onboarding' || view === 'loading') return;

    // 1. Fetch Drivers from 'seasons/season_1/drivers'
    const driversQuery = query(collection(db, 'seasons', 'season_1', 'drivers'));
    const unsubDrivers = onSnapshot(driversQuery, (snap) => {
      const d = [];
      snap.forEach(doc => d.push({ id: doc.id, ...doc.data() }));
      setDrivers(d);
      
      const teamMap = {};
      d.forEach(drv => {
        if (!drv.team) return;
        if (!teamMap[drv.team]) teamMap[drv.team] = { name: drv.team, points: 0, color: getTeamColor(drv.team) };
        teamMap[drv.team].points += (drv.totalPoints || 0);
      });
      setTeams(Object.values(teamMap).sort((a,b) => b.points - a.points));
    }, (err) => console.log("Driver fetch error (permissions?):", err));

    // 2. Fetch Tickets
    const unsubTickets = onSnapshot(query(collection(db, 'tickets')), (snap) => {
      const t = [];
      snap.forEach(doc => t.push({ id: doc.id, ...doc.data() }));
      t.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setTickets(t);
    }, (err) => console.log("Ticket fetch error (permissions?):", err));

    return () => { unsubDrivers(); unsubTickets(); };
  }, [view]);

  // --- ACTIONS ---

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authMode === 'register') {
        await createUserWithEmailAndPassword(auth, authForm.email, authForm.password);
      } else {
        await signInWithEmailAndPassword(auth, authForm.email, authForm.password);
      }
    } catch (error) {
      console.error("Auth Error:", error);
      
      let msg = error.message;
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        msg = "❌ Invalid email or password.";
      } else if (error.code === 'auth/email-already-in-use') {
        msg = "⚠️ Email already exists. Please switch to 'Sign In' tab.";
      } else if (error.code === 'auth/weak-password') {
        msg = "❌ Password must be at least 6 characters.";
      } else if (error.code === 'auth/network-request-failed') {
        msg = "❌ Network error. Check your connection.";
      }
      // Note: operation-not-allowed should NOT happen now if using the correct config

      setAuthError(msg);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error("Google Auth Error:", error);
      let msg = "Google Sign-In failed.";
      if (error.code === 'auth/unauthorized-domain') {
        msg = `⚠️ Domain Error: This preview URL is not in your authorized domains. Google Sign-In will work once you deploy this app. Please use Email/Password for testing now.`;
      } else if (error.code === 'auth/popup-closed-by-user') {
        msg = "Sign-in cancelled.";
      }
      setAuthError(msg);
    }
  };

  const handleOnboarding = async (e) => {
    e.preventDefault();
    if (!user || !user.email) return;

    const newProfile = {
      name: onboardData.name,
      steamId: onboardData.steamId,
      eaId: onboardData.eaId,
      email: user.email,
      createdAt: new Date().toISOString()
    };

    try {
      // 1. Create Profile in 'profiles' collection
      await setDoc(doc(db, 'profiles', user.email), newProfile);
      
      // 2. Try to Create Public Driver Entry
      try {
        await setDoc(doc(db, 'seasons', 'season_1', 'drivers', user.uid), {
          name: onboardData.name,
          team: 'Free Agent',
          totalPoints: 0,
          role: 'driver'
        });
      } catch (seasonError) {
        console.warn("Could not create public driver stats. Permissions likely restrict writing to 'seasons'. Profile saved anyway.", seasonError);
      }

      setProfile(newProfile);
      setView('dashboard');
    } catch (err) {
      console.error("Onboarding Critical Error:", err);
      alert("Failed to save profile. Check console for details.");
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      await updateDoc(doc(db, 'profiles', profile.email), {
        steamId: onboardData.steamId,
        eaId: onboardData.eaId
      });
      setProfile({ ...profile, steamId: onboardData.steamId, eaId: onboardData.eaId });
      alert("Profile Updated");
    } catch (err) { alert("Failed to update"); }
  };

  const createTicket = async (e) => {
    e.preventDefault();
    const accusedDriver = drivers.find(d => d.id === newTicket.accusedId);
    await addDoc(collection(db, 'tickets'), {
      reporterId: user.uid,
      reporterName: profile.name, 
      accusedId: newTicket.accusedId,
      accusedName: accusedDriver ? accusedDriver.name : 'Unknown',
      session: newTicket.session,
      lap: newTicket.lap,
      description: newTicket.description,
      evidence: newTicket.evidence,
      status: 'Open',
      accessList: [user.uid],
      messages: [],
      ruling: null,
      createdAt: new Date().toISOString()
    });
    setView('tickets');
    setNewTicket({ accusedId: '', session: 'Race', lap: '', description: '', evidence: '' });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatMessage.trim() || !activeTicketId) return;
    const ticketRef = doc(db, 'tickets', activeTicketId);
    const ticket = tickets.find(t => t.id === activeTicketId);
    const newMessage = {
      id: Date.now(),
      senderId: user.uid,
      senderName: role === 'steward' ? 'Steward' : profile.name,
      text: chatMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    await updateDoc(ticketRef, { messages: [...(ticket.messages || []), newMessage] });
    setChatMessage("");
  };

  const summonDriver = async (ticketId, accusedId) => {
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticket = tickets.find(t => t.id === ticketId);
    await updateDoc(ticketRef, { 
      accessList: [...ticket.accessList, accusedId], 
      status: 'Investigating',
      messages: [...(ticket.messages || []), {
        id: Date.now(), senderId: 'system', senderName: 'System', 
        text: 'DRIVER SUMMONED: Access granted.', timestamp: new Date().toLocaleTimeString()
      }]
    });
  };

  const closeTicket = async (ticketId, ruling) => {
    const ticketRef = doc(db, 'tickets', ticketId);
    const ticket = tickets.find(t => t.id === ticketId);
    await updateDoc(ticketRef, { 
      status: 'Closed', ruling,
      messages: [...(ticket.messages || []), {
        id: Date.now(), senderId: 'system', senderName: 'System', 
        text: `TICKET CLOSED: ${ruling}`, timestamp: new Date().toLocaleTimeString()
      }]
    });
  };

  const getTeamColor = (teamName) => {
    const colors = { 'Red Bull Racing': 'bg-blue-900', 'Ferrari': 'bg-red-600', 'Mercedes': 'bg-cyan-600', 'McLaren': 'bg-orange-500' };
    return colors[teamName] || 'bg-zinc-600';
  };
  const getWins = (d) => d.results ? Object.values(d.results).filter(r => r.position === "1").length : 0;
  const getDriverStats = () => drivers.find(d => d.id === user?.uid) || {};

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeTicketId, tickets]);

  const activeTicket = tickets.find(t => t.id === activeTicketId);

  // --- VIEW RENDERING ---

  if (view === 'loading') return <div className="h-screen bg-zinc-950 flex items-center justify-center text-white"><RefreshCw className="animate-spin mr-2"/> Loading...</div>;

  if (view === 'login') {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 space-y-6">
          <div className="text-center">
            <Flag className="w-16 h-16 text-red-600 mx-auto" />
            <h1 className="text-3xl font-bold text-white mt-4">Race Control</h1>
          </div>
          <div className="flex border-b border-zinc-700">
            <button onClick={() => setAuthMode('login')} className={`flex-1 pb-3 text-sm font-medium ${authMode === 'login' ? 'text-white border-b-2 border-red-600' : 'text-zinc-500'}`}>Sign In</button>
            <button onClick={() => setAuthMode('register')} className={`flex-1 pb-3 text-sm font-medium ${authMode === 'register' ? 'text-white border-b-2 border-red-600' : 'text-zinc-500'}`}>Sign Up</button>
          </div>
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <input type="email" required value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white" placeholder="Email" />
            <input type="password" required value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white" placeholder="Password" />
            {authError && <div className="bg-red-900/50 p-3 rounded text-red-200 text-sm text-center flex items-center justify-center border border-red-500/50"><AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0"/> {authError}</div>}
            <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded">{authMode === 'login' ? 'Sign In' : 'Create Account'}</button>
          </form>
          <button onClick={handleGoogleLogin} className="w-full bg-white text-black font-bold py-3 rounded flex items-center justify-center"><Chrome className="w-5 h-5 mr-2"/> Google</button>
          
          <div className="text-center mt-4 pt-4 border-t border-zinc-800">
             <p className="text-xs text-zinc-500 flex items-center justify-center">
               <Info className="w-3 h-3 mr-1" /> 
               Project: <span className="text-zinc-300 ml-1 font-mono">{firebaseConfig.projectId}</span>
             </p>
          </div>
        </Card>
      </div>
    );
  }

  if (view === 'onboarding') {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full p-8 space-y-6">
          <h1 className="text-2xl font-bold text-white">Driver Registration</h1>
          <form onSubmit={handleOnboarding} className="space-y-4">
            <input required value={onboardData.name} onChange={e => setOnboardData({...onboardData, name: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white" placeholder="Driver Name" />
            <input required value={onboardData.steamId} onChange={e => setOnboardData({...onboardData, steamId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white" placeholder="Steam64 ID" />
            <input required value={onboardData.eaId} onChange={e => setOnboardData({...onboardData, eaId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white" placeholder="EA ID" />
            <button className="w-full bg-cyan-600 text-white font-bold py-3 rounded">Complete Profile</button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex font-sans">
      <aside className="w-64 bg-zinc-900 border-r border-zinc-800 hidden md:flex flex-col p-4">
        <div className="flex items-center space-x-3 mb-8"><Flag className="h-8 w-8 text-red-600" /><span className="font-bold text-xl">APEX</span></div>
        <nav className="space-y-2">
          <SidebarBtn icon={LayoutDashboard} label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <SidebarBtn icon={AlertCircle} label="Stewards" active={view.includes('ticket')} onClick={() => setView('tickets')} />
          <SidebarBtn icon={Settings} label="Profile" active={view === 'settings'} onClick={() => { setOnboardData({ name: profile.name, steamId: profile.steamId, eaId: profile.eaId }); setView('settings'); }} />
        </nav>
        <div className="mt-auto pt-4 border-t border-zinc-800 flex items-center justify-between">
           <div>
             <div className="text-sm font-bold">{profile?.name}</div>
             <div className="text-xs text-zinc-500 uppercase">{role}</div>
           </div>
           <button onClick={() => { signOut(auth); setView('login'); }}><LogOut className="h-5 w-5 text-zinc-400"/></button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {view === 'dashboard' && (
           <div className="space-y-6">
             <h1 className="text-3xl font-bold">Dashboard</h1>
             {role === 'steward' && <div className="bg-red-900/20 border border-red-500/30 p-4 rounded text-red-200"><Shield className="inline mr-2"/> Steward Access Active</div>}
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6"><h3 className="text-zinc-400">Points</h3><div className="text-4xl font-bold mt-2">{getDriverStats().totalPoints || 0}</div></Card>
                <Card className="p-6"><h3 className="text-zinc-400">Wins</h3><div className="text-4xl font-bold mt-2">{getWins(getDriverStats())}</div></Card>
                <Card className="p-6"><h3 className="text-zinc-400">Team</h3><div className="text-2xl font-bold mt-2">{getDriverStats().team || 'Free Agent'}</div></Card>
             </div>
             <Card className="p-0 mt-6">
               <div className="p-4 border-b border-zinc-700 font-bold">Standings</div>
               <table className="w-full text-left text-sm">
                 <thead className="bg-zinc-800/50 text-zinc-400"><tr><th className="p-3">Pos</th><th className="p-3">Driver</th><th className="p-3 text-right">Pts</th></tr></thead>
                 <tbody className="divide-y divide-zinc-700">
                   {drivers.sort((a,b) => (b.totalPoints||0) - (a.totalPoints||0)).map((d,i) => (
                     <tr key={d.id} className={user.uid === d.id ? 'bg-zinc-700/50' : ''}>
                       <td className="p-3 text-zinc-500">{i+1}</td>
                       <td className="p-3">{d.name}</td>
                       <td className="p-3 text-right font-bold">{d.totalPoints||0}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </Card>
           </div>
        )}

        {view === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold">Profile</h1>
            <Card className="p-6">
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div><label className="text-zinc-500 text-sm">Email</label><div className="p-3 bg-zinc-900 rounded text-zinc-400">{profile.email}</div></div>
                <div><label className="text-zinc-500 text-sm">Name</label><div className="p-3 bg-zinc-900 rounded text-zinc-400">{profile.name}</div></div>
                <div className="border-t border-zinc-700 pt-4"><label className="text-zinc-500 text-sm">Steam ID</label><input value={onboardData.steamId} onChange={e => setOnboardData({...onboardData, steamId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white mt-1"/></div>
                <div><label className="text-zinc-500 text-sm">EA ID</label><input value={onboardData.eaId} onChange={e => setOnboardData({...onboardData, eaId: e.target.value})} className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded text-white mt-1"/></div>
                <button className="bg-cyan-600 text-white px-6 py-2 rounded">Save</button>
              </form>
            </Card>
          </div>
        )}

        {view === 'tickets' && (
           <div className="space-y-6">
             <div className="flex justify-between"><h1 className="text-3xl font-bold">Stewards Room</h1>{role !== 'steward' && <button onClick={() => setView('create-ticket')} className="bg-red-600 text-white px-4 py-2 rounded flex items-center"><Plus className="w-4 h-4 mr-2"/>New</button>}</div>
             <div className="grid gap-3">
               {tickets.filter(t => t.accessList.includes(user.uid) || role === 'steward').map(t => (
                 <Card key={t.id} className="p-4 flex justify-between items-center hover:bg-zinc-800/80 cursor-pointer" onClick={() => { setActiveTicketId(t.id); setView('ticket-detail'); }}>
                    <div><div className="flex items-center gap-2"><span className="font-bold">{t.session}</span><Badge status={t.status} /></div><div className="text-sm text-zinc-400 mt-1">{t.reporterName} vs {t.accusedName}</div></div>
                 </Card>
               ))}
             </div>
           </div>
        )}

        {view === 'create-ticket' && (
           <Card className="max-w-2xl mx-auto p-6">
              <h2 className="text-xl font-bold mb-4">New Report</h2>
              <form onSubmit={createTicket} className="space-y-4">
                 <input className="w-full bg-zinc-900 p-2 rounded border border-zinc-700" placeholder="Session" value={newTicket.session} onChange={e => setNewTicket({...newTicket, session: e.target.value})} />
                 <input className="w-full bg-zinc-900 p-2 rounded border border-zinc-700" placeholder="Lap" value={newTicket.lap} onChange={e => setNewTicket({...newTicket, lap: e.target.value})} />
                 <select className="w-full bg-zinc-900 p-2 rounded border border-zinc-700" value={newTicket.accusedId} onChange={e => setNewTicket({...newTicket, accusedId: e.target.value})}>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                 <textarea className="w-full bg-zinc-900 p-2 rounded border border-zinc-700" rows="3" placeholder="Description" value={newTicket.description} onChange={e => setNewTicket({...newTicket, description: e.target.value})} />
                 <input className="w-full bg-zinc-900 p-2 rounded border border-zinc-700" placeholder="Evidence URL" value={newTicket.evidence} onChange={e => setNewTicket({...newTicket, evidence: e.target.value})} />
                 <button className="bg-red-600 text-white px-6 py-2 rounded">Submit</button>
              </form>
           </Card>
        )}
        
        {view === 'ticket-detail' && activeTicket && (
           <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-100px)]">
              <div className="md:w-1/3 space-y-4">
                 <button onClick={() => setView('tickets')} className="text-sm text-zinc-400">← Back</button>
                 <Card className="p-4 space-y-4">
                    <h2 className="font-bold text-xl">#{activeTicket.id}</h2><Badge status={activeTicket.status} />
                    <p className="text-zinc-300">{activeTicket.description}</p>
                    <a href={activeTicket.evidence} target="_blank" rel="noreferrer" className="text-cyan-400 flex items-center text-sm"><ExternalLink className="w-3 h-3 mr-1"/> Evidence</a>
                    {role === 'steward' && activeTicket.status !== 'Closed' && (<div className="pt-4 border-t border-zinc-700 space-y-2"><button onClick={() => summonDriver(activeTicket.id, activeTicket.accusedId)} className="w-full bg-blue-900/50 text-blue-200 p-2 rounded text-sm">Summon Driver</button><button onClick={() => closeTicket(activeTicket.id, prompt('Ruling?'))} className="w-full bg-red-900/50 text-red-200 p-2 rounded text-sm">Penalize & Close</button></div>)}
                 </Card>
              </div>
              <div className="md:w-2/3 flex flex-col bg-zinc-900 rounded border border-zinc-800">
                 <div className="flex-1 overflow-y-auto p-4 space-y-3">{(activeTicket.messages||[]).map(m => (<div key={m.id} className={`p-2 rounded max-w-[80%] ${m.senderId === user.uid ? 'ml-auto bg-cyan-900/30' : 'bg-zinc-800'}`}><div className="text-xs text-zinc-500 font-bold mb-1">{m.senderName}</div><div>{m.text}</div></div>))}<div ref={messagesEndRef} /></div>
                 {activeTicket.status !== 'Closed' && (<form onSubmit={sendMessage} className="p-3 border-t border-zinc-800 flex gap-2"><input className="flex-1 bg-zinc-950 p-2 rounded border border-zinc-700" value={chatMessage} onChange={e => setChatMessage(e.target.value)} /><button className="bg-cyan-600 p-2 rounded"><Send className="w-4 h-4 text-white"/></button></form>)}
              </div>
           </div>
        )}
      </main>
    </div>
  );
}

const SidebarBtn = ({ icon: Icon, label, active, onClick }) => (<button onClick={onClick} className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${active ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white'}`}><Icon className="h-5 w-5" /> <span>{label}</span></button>);
