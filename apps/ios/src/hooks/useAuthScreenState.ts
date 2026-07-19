import { useReducerState } from './useReducerState';

export function useAuthScreenState() {
  const [transaction, setTransaction] = useReducerState('"I spent $186 dining out this week"');
  const [brief, setBrief] = useReducerState({
    action: 'Cap dining out at $100 to stay on track for your Japan trip goal.',
    impact: 'Potential impact: Save $45',
  });
  const [email, setEmail] = useReducerState('');
  const [password, setPassword] = useReducerState('');
  const [busy, setBusy] = useReducerState(false);
  const [showLogin, setShowLogin] = useReducerState(false);
  const [mode, setMode] = useReducerState<'register' | 'login'>('register');
  const [touched, setTouched] = useReducerState(false);
  const [appleAvailable, setAppleAvailable] = useReducerState(false);
  const [reset, setReset] = useReducerState<'off' | 'request' | 'confirm'>('off');
  const [resetCode, setResetCode] = useReducerState('');

  return {
    transaction, setTransaction, brief, setBrief, email, setEmail, password, setPassword,
    busy, setBusy, showLogin, setShowLogin, mode, setMode, touched, setTouched,
    appleAvailable, setAppleAvailable, reset, setReset, resetCode, setResetCode,
  };
}
