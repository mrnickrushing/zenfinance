import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { create, open } from 'react-native-plaid-link-sdk';

// Phase 1 link harness: sign in → link a bank via Plaid Link → watch the
// 90-day backfill land → disconnect. The real app UI comes in Phase 4.

const API_URL: string = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

interface Account {
  id: number;
  name: string;
  mask: string | null;
  currentBalanceCents: number | null;
}
interface Item {
  id: number;
  institutionName: string | null;
  lastSyncedAt: string | null;
  accounts: Account[];
}

async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await SecureStore.getItemAsync('accessToken');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401 && retry) {
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    if (refreshToken) {
      const r = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (r.ok) {
        const tokens = await r.json();
        await SecureStore.setItemAsync('accessToken', tokens.accessToken);
        await SecureStore.setItemAsync('refreshToken', tokens.refreshToken);
        return api<T>(path, init, false);
      }
    }
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync('accessToken').then((t) => setAuthed(Boolean(t)));
  }, []);

  if (authed === null) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }
  return authed ? <LinkScreen onSignOut={() => setAuthed(false)} /> : (
    <AuthScreen onAuthed={() => setAuthed(true)} />
  );
}

function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(path: 'register' | 'login') {
    setBusy(true);
    try {
      const tokens = await api<{ accessToken: string; refreshToken: string }>(
        `/api/auth/${path}`,
        { method: 'POST', body: JSON.stringify({ email, password }) },
        false,
      );
      await SecureStore.setItemAsync('accessToken', tokens.accessToken);
      await SecureStore.setItemAsync('refreshToken', tokens.refreshToken);
      onAuthed();
    } catch (err) {
      Alert.alert('Auth failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      <Text style={styles.title}>ZenFinance</Text>
      <Text style={styles.subtitle}>Phase 1 link harness</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password (10+ chars)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Button title={busy ? '…' : 'Sign in'} disabled={busy} onPress={() => submit('login')} />
      <Button title="Create account" disabled={busy} onPress={() => submit('register')} />
    </SafeAreaView>
  );
}

function LinkScreen({ onSignOut }: { onSignOut: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [txnCount, setTxnCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [itemsRes, txns] = await Promise.all([
      api<{ items: Item[] }>('/api/items'),
      api<{ total: number }>('/api/transactions?pageSize=1'),
    ]);
    setItems(itemsRes.items);
    setTxnCount(txns.total);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  async function linkBank() {
    setBusy(true);
    try {
      const { linkToken } = await api<{ linkToken: string }>('/api/link/token', {
        method: 'POST',
      });
      create({ token: linkToken });
      open({
        onSuccess: async (success) => {
          await api('/api/link/exchange', {
            method: 'POST',
            body: JSON.stringify({
              publicToken: success.publicToken,
              institutionName: success.metadata.institution?.name,
            }),
          });
          await refresh();
          setBusy(false);
        },
        onExit: () => setBusy(false),
      });
    } catch (err) {
      Alert.alert('Link failed', err instanceof Error ? err.message : 'Unknown error');
      setBusy(false);
    }
  }

  async function disconnect(itemId: number) {
    await api(`/api/items/${itemId}`, { method: 'DELETE' });
    await refresh();
  }

  async function signOut() {
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    if (refreshToken) {
      await api('/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    onSignOut();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Linked banks</Text>
      <Text style={styles.subtitle}>{txnCount} transactions synced</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        refreshing={busy}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.institutionName ?? 'Bank'}</Text>
            {item.accounts.map((a) => (
              <Text key={a.id} style={styles.cardLine}>
                {a.name} ····{a.mask} — $
                {((a.currentBalanceCents ?? 0) / 100).toFixed(2)}
              </Text>
            ))}
            <Text style={styles.cardMeta}>
              Last sync: {item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString() : 'pending…'}
            </Text>
            <Button title="Disconnect" color="#b91c1c" onPress={() => disconnect(item.id)} />
          </View>
        )}
        ListEmptyComponent={<Text style={styles.cardMeta}>No banks linked yet.</Text>}
      />
      <Button title={busy ? 'Linking…' : 'Link a bank account'} disabled={busy} onPress={linkBank} />
      <Button title="Sign out" onPress={signOut} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', marginTop: 16 },
  subtitle: { fontSize: 15, color: '#64748b', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 16,
    marginVertical: 6,
    gap: 4,
  },
  cardTitle: { fontWeight: '600', fontSize: 16 },
  cardLine: { fontSize: 14 },
  cardMeta: { fontSize: 12, color: '#94a3b8' },
});
