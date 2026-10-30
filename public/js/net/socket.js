// WebSocket connection manager (Socket.IO client loaded by index.html).
// It hides acknowledgement details: request() resolves with data or throws an Error.

const TIMEOUT_MS = 6000;

export function createConnection() {
  const socket = window.io({ reconnectionDelayMax: 4000 });

  /** Sends an event and waits for the server's { ok, data | error } answer. */
  async function request(event, payload = {}) {
    let response;
    try {
      response = await socket.timeout(TIMEOUT_MS).emitWithAck(event, payload);
    } catch {
      throw new Error("Le serveur ne répond pas. Vérifie ta connexion.");
    }
    if (!response?.ok) throw new Error(response?.error || "Action refusée.");
    return response.data;
  }

  /** Listens to a server event. Returns a function that stops listening. */
  function on(event, handler) {
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }

  return { socket, request, on };
}
