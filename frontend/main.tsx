import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Answers render with Markora, whose stylesheets the host supplies (README, Custom UI).
import 'markora/styles.css'
import 'markora-extension-components/styles.css'
import './style.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
