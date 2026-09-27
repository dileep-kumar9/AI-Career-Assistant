import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { RequireAuth } from "./components/auth/RequireAuth";

// Route-level code splitting keeps the first load small.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const BuilderStart = lazy(() => import("./pages/BuilderStart").then((m) => ({ default: m.BuilderStart })));
const BuilderWorkspace = lazy(() => import("./pages/BuilderWorkspace").then((m) => ({ default: m.BuilderWorkspace })));
const MyResumes = lazy(() => import("./pages/MyResumes").then((m) => ({ default: m.MyResumes })));
const SingleApply = lazy(() => import("./pages/SingleApply").then((m) => ({ default: m.SingleApply })));
const Agent = lazy(() => import("./pages/Agent").then((m) => ({ default: m.Agent })));
const Tracker = lazy(() => import("./pages/Tracker").then((m) => ({ default: m.Tracker })));
const Interview = lazy(() => import("./pages/Interview").then((m) => ({ default: m.Interview })));
const Skills = lazy(() => import("./pages/Skills").then((m) => ({ default: m.Skills })));
const Assistant = lazy(() => import("./pages/Assistant").then((m) => ({ default: m.Assistant })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center text-muted-foreground">
    <Loader2 className="w-5 h-5 animate-spin" />
  </div>
);

/** Signed in (or single-user local mode) → dashboard; otherwise the landing page. */
const Home = () => {
  const { enabled, user, loading } = useAuth();
  if (enabled && loading) return <Loading />;
  return !enabled || user ? <Dashboard /> : <Index />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/builder" element={<RequireAuth><BuilderStart /></RequireAuth>} />
              <Route path="/builder/:sessionId" element={<RequireAuth><BuilderWorkspace /></RequireAuth>} />
              <Route path="/resumes" element={<RequireAuth><MyResumes /></RequireAuth>} />
              <Route path="/apply" element={<RequireAuth><SingleApply /></RequireAuth>} />
              <Route path="/agent" element={<RequireAuth><Agent /></RequireAuth>} />
              <Route path="/tracker" element={<RequireAuth><Tracker /></RequireAuth>} />
              <Route path="/interview" element={<RequireAuth><Interview /></RequireAuth>} />
              <Route path="/skills" element={<RequireAuth><Skills /></RequireAuth>} />
              <Route path="/assistant" element={<RequireAuth><Assistant /></RequireAuth>} />
              <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
