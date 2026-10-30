// SPA navigation: picks the screen from the server state and swaps it
// without reloading the page. Each screen is a function (root, ctx) that
// returns { update(state), destroy() }.
import { PHASES } from "/shared/constants.js";

export function screenFor(state) {
  if (!state.room) return "home";
  if (state.room.phase === PHASES.LOBBY) return "lobby";
  if (state.room.phase === PHASES.ENDED) return "end";
  return "game";
}

export function createRouter(root, screens, ctx) {
  let currentName = null;
  let current = null;

  return {
    render(state) {
      const name = screenFor(state);
      if (name !== currentName) {
        current?.destroy?.();
        root.replaceChildren();
        currentName = name;
        current = screens[name](root, ctx);
        window.scrollTo({ top: 0 });
      }
      current.update?.(state);
    },
  };
}
