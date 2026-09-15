import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@shared/src/index.css'
import { TRPCProvider } from "@shared/src/providers/trpc"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
