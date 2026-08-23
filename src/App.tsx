import { Route, Routes } from 'react-router'
import ChipsScreen from './screens/ChipsScreen'
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
 * commit control. <BrowserRouter> is provided by main.tsx.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/squad" element={<SquadEntryScreen />} />
      <Route path="/reasoning" element={<ReasoningScreen />} />
      <Route path="/chips" element={<ChipsScreen />} />
      <Route path="/override" element={<OverrideScreen />} />
    </Routes>
  )
}

export default App
