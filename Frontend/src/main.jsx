import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-react/dist/Assets.js'
import '@ui5/webcomponents/dist/Assets-fetch.js'
import '@ui5/webcomponents-fiori/dist/Assets-fetch.js'
import '@ui5/webcomponents-icons/dist/AllIcons-fetch.js'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
)
