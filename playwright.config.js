import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests',timeout:30000,workers:1,
  use:{baseURL:'http://127.0.0.1:4173',headless:true,
    launchOptions:process.env.PW_EXECUTABLE_PATH?{executablePath:process.env.PW_EXECUTABLE_PATH}:{},
    reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[
    {command:'python3 -m http.server 4173 --bind 127.0.0.1 --directory dist',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
    {command:'node tests/peer-server.cjs',url:'http://127.0.0.1:9000/peerjs',reuseExistingServer:!process.env.CI}
  ]
});
