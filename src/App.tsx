import { Route, Routes } from 'react-router'
import HomeScreen from './screens/HomeScreen'
import SquadEntryScreen from './screens/SquadEntryScreen'

/**
 * Ticket #13 — client-side routing. `/` renders the #8 shell unchanged
 * (moved, not rewritten, to src/screens/HomeScreen.tsx); `/squad` renders
 * the manual squad-entry screen. <BrowserRouter> is provided by main.tsx.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/squad" element={<SquadEntryScreen />} />
    </Routes>
  )
}

export default App
