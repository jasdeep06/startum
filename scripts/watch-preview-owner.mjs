// The preview is a separate process group so normal shutdown can stop its
// children. Also stop it if the owning Stratum process disappears abruptly.
const owner = Number(process.env.STRATUM_PREVIEW_OWNER_PID);
delete process.env.STRATUM_PREVIEW_OWNER_PID;
if (!Number.isSafeInteger(owner) || owner <= 1) throw new Error('A Stratum preview owner is required.');

const watch = setInterval(() => {
  try { process.kill(owner, 0); }
  catch (error) {
    if (error.code !== 'ESRCH') return;
    clearInterval(watch);
    process.kill(process.platform === 'win32' ? process.pid : -process.pid, 'SIGTERM');
  }
}, 1000);
watch.unref();
