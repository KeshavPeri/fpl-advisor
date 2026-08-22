import { Route, Routes } from 'react-router'
import HomeScreen from './screens/HomeScreen'
import ReasoningScreen from './screens/ReasoningScreen'
import SquadEntryScreen from './screens/SquadEntryScreen'

/**
 * Ticket #13 — client-side routing. `/` renders the #8 shell unchanged
 * (moved, not rewritten, to src/screens/HomeScreen.tsx); `/squad` renders
 * the manual squad-entry screen. `/reasoning` (ticket #79) renders the full
 * reasoning screen, reached by tapping through from the verdict card's new
 * link. <BrowserRouter> is provided by main.tsx.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/squad" element={<SquadEntryScreen />} />
      <Route path="/reasoning" element={<ReasoningScreen />} />
    </Routes>
  )
}

export default App
