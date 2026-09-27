import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { AuthProvider } from "./contexts/AuthContext";
import { RequireAuth } from "./components/auth/RequireAuth";

// Route-level code splitting keeps the first load small.
const BuilderStart = lazy(() => import("./pages/BuilderStart").then((m) => ({ default: m.BuilderStart })));
const BuilderWorkspace = lazy(() => import("./pages/BuilderWorkspace").then((m) => ({ default: m.BuilderWorkspace })));
const MyResumes = lazy(() => import("./pages/MyResumes").then((m) => ({ default: m.MyResumes })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const About = lazy(() => import("./pages/About").then((m) => ({ default: m.About })));

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center text-muted-foreground">
    <Loader2 className="w-5 h-5 animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* Session-based ATS builder */}
            <Route path="/login" element={<Login />} />
            <Route path="/builder" element={<RequireAuth><BuilderStart /></RequireAuth>} />
            <Route path="/builder/:sessionId" element={<RequireAuth><BuilderWorkspace /></RequireAuth>} />
            <Route path="/resumes" element={<RequireAuth><MyResumes /></RequireAuth>} />
            <Route path="/about" element={<About />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
