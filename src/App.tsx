import { Route, Routes } from 'react-router'
import AppBar from './components/AppBar'
import ChipsScreen from './screens/ChipsScreen'
import DecisionHistoryScreen from './screens/DecisionHistoryScreen'
import HomeScreen from './screens/HomeScreen'
import OverrideScreen from './screens/OverrideScreen'
import ReasoningScreen from './screens/ReasoningScreen'
import SquadEntryScreen from './screens/SquadEntryScreen'

/**
 * Ticket #13 — client-side routing. `/` renders the #8 shell unchanged
 * (moved, not rewritten, to src/screens/HomeScreen.tsx); `/squad` renders
 * the manual squad-entry screen. `/reasoning` (ticket #79) renders the full
 * reasoning screen, reached by tapping through from the verdict card's new
 * link. `/chips` (ticket #85) renders the chip-state screen, reached from
 * the home screen's new link. `/override` (ticket #91) renders override
 * registration, reached from the verdict card's own new link alongside its
 * commit control. `/decisions` (ticket #103) renders the decision history —
 * the append-only ledger of what was actually committed or overridden,
 * reached from the home screen's mark row alongside the existing `/chips`
 * link. <BrowserRouter> is provided by main.tsx.
 *
 * Ticket #166 / docs/ui-audit-2026-08-31.md F17 — <AppBar> renders here,
 * as a sibling of <Routes> rather than inside any one screen, so it is a
 * single persistent DOM node across every navigation instead of
 * unmounting and remounting with each screen. Each screen still wraps
 * its own content in <AppShell>, which reserves the bottom space the bar
 * needs (AppShell.css) so nothing is ever covered by it.
 */
function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/squad" element={<SquadEntryScreen />} />
        <Route path="/reasoning" element={<ReasoningScreen />} />
        <Route path="/chips" element={<ChipsScreen />} />
        <Route path="/override" element={<OverrideScreen />} />
        <Route path="/decisions" element={<DecisionHistoryScreen />} />
      </Routes>
      <AppBar />
    </>
  )
}

export default App
