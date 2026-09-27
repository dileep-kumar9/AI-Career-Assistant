import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';

/** Account menu for the signed-in user, or a "Sign in" button. Hidden when sign-in is not configured. */
export const UserMenu: React.FC = () => {
  const { enabled, user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  if (!enabled || loading) return null;
  if (!user) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link to="/login">
          <LogIn className="w-4 h-4 mr-1.5" /> Sign in
        </Link>
      </Button>
    );
  }
  const label = user.displayName || user.email || 'Account';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-semibold overflow-hidden flex items-center justify-center" aria-label="Account menu">
          {user.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : label.trim().charAt(0).toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium truncate">{user.displayName || 'Signed in'}</div>
          <div className="text-xs text-muted-foreground truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/resumes')}>
          <FileText className="w-4 h-4 mr-2" /> My resumes
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => signOut().then(() => navigate('/'))}>
          <LogOut className="w-4 h-4 mr-2" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
