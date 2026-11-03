import { verifyAppUser } from './serverSecurity.ts';

export async function verifyVoiceUser(token: unknown, request = fetch): Promise<string> {
  return (await verifyAppUser(token, request)).uid;
}

// A recording or model response may outlive a change to an account's access.
export function monitorVoiceAccess(check: () => Promise<string>, uid: string, deny: () => void, intervalMs = 60000) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(async () => {
      let current: string | undefined;
      try { current = await check(); } catch { /* Loss of verification ends the session. */ }
      if (stopped) return;
      if (current !== uid) { stopped = true; deny(); return; }
      schedule();
    }, intervalMs);
    timer.unref();
  };
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}
