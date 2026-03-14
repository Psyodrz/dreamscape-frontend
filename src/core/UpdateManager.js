import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { App } from '@capacitor/app';
import { Dialog } from '@capacitor/dialog';
import { Toast } from '@capacitor/toast';
import { Capacitor } from '@capacitor/core';

export class UpdateManager {
    constructor() {
        this.baseUrl = 'https://maze-nine-opal.vercel.app';
        this.currentVersion = '1.0.1'; // Matches package.json
        this.isCheckInProgress = false;
        this.platform = Capacitor.getPlatform(); // 'web', 'ios', 'android'
        console.log('UpdateManager: Running on platform:', this.platform);
    }

    async init() {
        console.log('UpdateManager: Initializing...');
        
        if (this.platform !== 'web') {
            // NATIVE INITIALIZATION
            try {
                const info = await App.getInfo();
                this.currentVersion = info.version;
                console.log('UpdateManager: Current Native App Version:', this.currentVersion);
                await CapacitorUpdater.notifyAppReady();
                console.log('UpdateManager: Notified app ready');
            } catch (e) {
                console.warn('UpdateManager: Native init failed', e);
            }
        } else {
            // WEB/PWA INITIALIZATION
            this._initServiceWorker();
        }
        
        // Start periodic check (every 15 minutes)
        this.startPeriodicCheck();
    }

    startPeriodicCheck() {
        // Check every 15 minutes
        setInterval(() => {
            console.log('UpdateManager: Running periodic update check...');
            this.checkForUpdate(false);
        }, 15 * 60 * 1000); 
    }

    _initServiceWorker() {
        if ('serviceWorker' in navigator) {
            // Listen for new service workers (updates)
            navigator.serviceWorker.ready.then(registration => {
                console.log('UpdateManager: SW Ready');
            });

            // If a new SW is waiting, it means an update is ready
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('UpdateManager: Controller changed, reloading...');
                window.location.reload();
            });
        }
    }

    async checkForUpdate(manual = false) {
        if (this.isCheckInProgress) return;
        this.isCheckInProgress = true;

        if (manual) {
            await Toast.show({
                text: 'Checking for updates...',
                duration: 'short'
            });
        }

        try {
            if (this.platform === 'web') {
                await this._checkWebUpdate(manual);
            } else {
                await this._checkNativeUpdate(manual);
            }
        } catch (error) {
            console.error('UpdateManager: Error checking for update:', error);
            if (manual) {
                await Dialog.alert({
                    title: 'Update Check Failed',
                    message: 'Could not connect to update server. Please check internet.'
                });
            }
        } finally {
            this.isCheckInProgress = false;
        }
    }

    async _checkWebUpdate(manual) {
        console.log('UpdateManager: Checking Web Update...');
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg) {
                await reg.update(); // Force check
                console.log('UpdateManager: SW update triggered');
                
                // If manual check, we should tell them if it's up to date or not.
                // However, SW update is async and doesn't return "found update" directly easily without more complex event listeners.
                // For now, we assume if no controllerchange happens quickly, it's likely up to date.
                if (manual) {
                     await Toast.show({
                        text: 'Update check complete.',
                        duration: 'short'
                    });
                }
            } else {
                 console.log('UpdateManager: No SW registered');
            }
        }
        
        // Also check version.json just to show the user "A new version is available" visualization
        // even if the SW handles the actual caching.
        try {
             // Append timestamp to avoid caching the version file itself
            const response = await fetch(`${this.baseUrl}/version.json?t=${Date.now()}`);
            if (response.ok) {
                const data = await response.json();
                // We use a simplified version check here just for UI feedback
                 // In a real PWA, the SW cache is the source of truth, but this gives user confidence.
                 console.log('UpdateManager: Remote version:', data.version);
            }
        } catch(e) { /* ignore */ }
    }

    async _checkNativeUpdate(manual) {
        console.log('UpdateManager: Checking Native Update...');
        // Fetch version.json from the server
        const response = await fetch(`${this.baseUrl}/version.json?t=${Date.now()}`);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch version info: ${response.status}`);
        }

        const data = await response.json();
        console.log('UpdateManager: Remote version info:', data);

        const hasUpdate = this.compareVersions(data.version, this.currentVersion) > 0;

        if (hasUpdate) {
            console.log(`UpdateManager: Update available! ${this.currentVersion} -> ${data.version}`);
            
            const confirmed = await Dialog.confirm({
                title: 'Update Available',
                message: `Version ${data.version} is available.\n\n${data.note || 'New features and improvements.'}\n\nUpdate now?`,
                okButtonTitle: 'Update',
                cancelButtonTitle: 'Later'
            });

            if (confirmed.value) {
                await this.performNativeUpdate(data);
            }
        } else {
            console.log('UpdateManager: App is up to date');
            if (manual) {
                await Dialog.alert({
                    title: 'Up to Date',
                    message: `You are on the latest version (${this.currentVersion}).`
                });
            }
        }
    }

    async performNativeUpdate(versionData) {
        try {
            await Toast.show({
                text: 'Downloading... This may take a moment.',
                duration: 'long'
            });

            const version = await CapacitorUpdater.download({
                url: versionData.url,
                version: versionData.version
            });

            console.log('UpdateManager: Download complete', version);
            await CapacitorUpdater.set(version);
            
            // Native Plugin handles reload, but we can force it or alert
             await Dialog.alert({
                title: 'Update Ready',
                message: 'App will restart to apply updates.'
            });
            
            // In many cases CapacitorUpdater.set triggers reload, but if not:
             window.location.reload();

        } catch (error) {
            console.error('UpdateManager: Update failed:', error);
            await Dialog.alert({
                title: 'Update Failed',
                message: 'Download failed. Please try again.'
            });
        }
    }

    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    getCurrentVersion() {
        return this.currentVersion;
    }
}

const updateManager = new UpdateManager();
export default updateManager;

