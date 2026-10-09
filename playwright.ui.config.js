import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests',testMatch:'ui.spec.js',timeout:30000,workers:1,
  use:{baseURL:'https://game.test',headless:true,reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure',
    launchOptions:process.env.PW_EXECUTABLE_PATH?{executablePath:process.env.PW_EXECUTABLE_PATH}:{}}
});
