// Import this module before anything that constructs a persisted store at
// import time (themeStore is the common one). Its module body runs during the
// first import's evaluation, before the sibling imports that follow it.
import { installMemoryStorage } from './memoryStorage';

installMemoryStorage();
