# Contrat d'événements WebSocket

Tous les noms d'événements sont définis une seule fois dans `shared/constants.js` (`EVENTS`), importé par le serveur et par le navigateur.

## Format

Le projet utilise **Socket.IO** (déjà présent dans le starter). L'enveloppe proposée par le cahier des charges correspond ainsi :

| Champ du cahier des charges | Avec Socket.IO |
| --- | --- |
| `type` | nom de l'événement (`"vote:cast"`) |
| `payload` | objet envoyé avec l'événement |
| `roomId` | pas envoyé : le serveur connaît la ville du joueur via sa connexion (`socket.data.roomCode`) |
| `requestId` | l'*acknowledgement* Socket.IO (callback) relie la réponse à la requête |

Chaque événement client → serveur reçoit **toujours** une réponse :

```js
{ ok: true, data }        // accepté
{ ok: false, error }      // refusé, message en français affichable tel quel
```

Une requête invalide ne modifie **rien** et ne fait jamais planter le serveur (`safe()` dans `server/handlers.js`).

## Client → serveur

| Événement | Qui peut l'envoyer | Payload | Validation | Effet / diffusion |
| --- | --- | --- | --- | --- |
| `room:create` | tout le monde | `{ name }` | nom non vide, ≤ 20 caractères | crée la ville ; renvoie `{ code, sessionId }` ; `room:state` au créateur |
| `room:join` | tout le monde | `{ code, name }` | ville existante, en salon, pas pleine (12), nom unique | `room:state` à tous + annonce système |
| `room:resume` | tout le monde | `{ sessionId }` | session connue | reprend la place (refresh, coupure réseau) ; `chat:history` + `room:state` |
| `room:leave` | un joueur dans une ville | `{}` | — | salon : retiré ; en partie : compté comme mort (« a quitté la ville ») |
| `room:settings` | hôte, en salon | `{ settings: { nightSeconds?, discussionSeconds?, voteSeconds?, revealRolesOnDeath? } }` | bornes dans `server/config.js` | `room:state` à tous |
| `player:ready` | joueur, en salon | `{ ready }` | phase salon | `room:state` à tous |
| `game:start` | hôte | `{}` | salon, ≥ `MIN_PLAYERS`, tous connectés et prêts | rôles distribués, phase `roleReveal` |
| `game:restart` | hôte | `{}` | phase `ended` | retour au salon avec les mêmes joueurs |
| `night:action` | joueur vivant avec un pouvoir | `{ targetId, kidnapId? }` | phase nuit, cible vivante, règles du rôle (`validateNightAction`) | `room:state` ; la nuit se termine quand tous les acteurs connectés ont choisi |
| `day:skip` | hôte | `{}` | phase `discussion` | passe directement au vote |
| `vote:cast` | joueur vivant non kidnappé | `{ targetId }` (`null` = retirer) | phase vote, cible vivante, pas soi-même | `room:state` (votes publics) ; le vote se termine quand tous les votants connectés ont voté |
| `chat:send` | voir règles du chat | `{ channel, text }` | canal autorisé, 1–300 caractères, 5 messages / 5 s | `chat:message` aux seuls lecteurs du canal |

## Serveur → client

| Événement | Destinataire | Payload |
| --- | --- | --- |
| `room:state` | chaque joueur, **individuellement** | vue personnalisée (`server/views.js`) : joueurs (rôle seulement si autorisé), phase, `phaseEndsAt`, `serverNow`, votes publics, journal, et `me` (mon rôle, mes cibles possibles, mes résultats, mes droits de chat) |
| `chat:message` | joueurs autorisés à lire le canal | `{ id, channel, kind, author, text, ts }` |
| `chat:history` | un joueur (arrivée, reconnexion, mort, nouvelle partie) | `{ lobby: [], village: [], mafia: [], dead: [], system: [] }` |
| `night:result` | Détective ou Espion seulement | `{ playerId, title, text, round }` |
| `notice` | un joueur | `{ text, level }` (ex. session ouverte dans un autre onglet) |

Il n'y a pas d'événement `timer:updated` : le serveur envoie l'heure de fin (`phaseEndsAt`) et son heure (`serverNow`), le navigateur fait le décompte. Moins de trafic, et pas de dérive.

## Règles du chat

| Canal | Qui lit | Qui écrit | Quand |
| --- | --- | --- | --- |
| `lobby` (Salon) | tous | tous | salon et fin de partie |
| `village` | tous (les morts lisent en spectateurs) | vivants non kidnappés | aube, débat, vote, verdict |
| `mafia` | Mafia **vivante** uniquement | Mafia vivante | nuit (historique lisible le jour) |
| `dead` (Cimetière) | morts | morts | pendant la partie |
| `system` | tous | serveur seulement | toujours |

Les messages sont insérés avec `textContent` (jamais `innerHTML`) : un `<script>` s'affiche comme du texte.
