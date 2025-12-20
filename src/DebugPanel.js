import GUI from 'lil-gui'; 
import * as THREE from 'three';

export class DebugPanel {
  constructor(game) {
    this.game = game;
    
    // Main Panel (Right) - Player & Environment
    this.gui = new GUI({ title: 'Maze Debugger', width: 300 });
    this.gui.domElement.style.position = 'absolute';
    this.gui.domElement.style.top = '10px';
    this.gui.domElement.style.right = '10px';
    
    // Ghost Panel (Left) - Ghost Settings & Animations
    this.ghostGui = new GUI({ title: 'Ghost Control', width: 300 });
    this.ghostGui.domElement.style.position = 'absolute';
    this.ghostGui.domElement.style.top = '10px';
    this.ghostGui.domElement.style.left = '10px';
    
    this._setupPlayerPanel();
    this._setupGhostPanel(); // Uses ghostGui
    this._setupEnvironmentPanel();
    this._setupExportPanel();
  }

  _setupPlayerPanel() {
    if (!this.game.player) return;
    
    const folder = this.gui.addFolder('Player Physics');
    const config = this.game.player.config;
    
    const params = {
      radius: config.radius,
      height: config.height,
      mass: config.mass,
      moveSpeed: config.speed,
      jumpForce: config.jumpSpeed,
      rebuild: () => {
        // Update config
        this.game.player.config.radius = params.radius;
        this.game.player.config.height = params.height;
        this.game.player.config.mass = params.mass;
        this.game.player.config.speed = params.moveSpeed;
        this.game.player.config.jumpSpeed = params.jumpForce;
        
        // Rebuild body
        this.game.player.rebuildPhysics();
      }
    };
    
    folder.add(params, 'radius', 0.1, 1.0).name('Radius').onChange(params.rebuild);
    folder.add(params, 'height', 1.0, 3.0).name('Height').onChange(params.rebuild);
    folder.add(params, 'mass', 10, 200).name('Mass').onChange(params.rebuild);
    folder.add(params, 'moveSpeed', 1, 20).name('Speed').onChange(v => this.game.player.config.speed = v);
    folder.add(params, 'jumpForce', 1, 20).name('Jump Force').onChange(v => this.game.player.config.jumpSpeed = v);
    folder.add(params, 'rebuild').name('Force Rebuild');
    
    const visualFolder = folder.addFolder('Visual Model Adjustment');
    const visParams = {
        offsetY: this.game.player.visualOffset.y,
        invincible: this.game.player.isInvincible
    };
    
    visualFolder.add(visParams, 'offsetY', -5, 5).name('Vertical Offset').onChange(v => {
        this.game.player.visualOffset.y = v;
    });
    
    visualFolder.add(visParams, 'invincible').name('God Mode').onChange(v => {
        this.game.player.isInvincible = v;
    });
  }

  _setupGhostPanel() {
    // Use ghostGui for this section
    const folder = this.ghostGui.addFolder('Ghost Physics');
    
    const getGhost = () => this.game.ghosts.length > 0 ? this.game.ghosts[0] : null;
    
    const params = {
      radius: 0.5,
      height: 2.0,
      rebuild: () => {
        const ghost = getGhost();
        if (ghost && ghost.rebuildPhysics) {
          ghost.radius = params.radius;
          ghost.height = params.height;
          ghost.rebuildPhysics();
        }
      }
    };
    
    // Update params if ghost exists
    const ghost = getGhost();
    if (ghost) {
       params.radius = ghost.radius || 0.5;
       params.height = ghost.height || 2.0;
    }

    folder.add(params, 'radius', 0.1, 1.5).name('Radius').onChange(params.rebuild);
    folder.add(params, 'height', 1.0, 4.0).name('Height').onChange(params.rebuild);
    folder.add(params, 'rebuild').name('Force Rebuild');
    
    // Visual Adjustment
    const visualFolder = this.ghostGui.addFolder('Visual Model Adjustment');
    const visParams = {
        offsetY: -1.0
    };
    
    if (ghost && ghost.visualOffset) {
        visParams.offsetY = ghost.visualOffset.y;
    }
    
    visualFolder.add(visParams, 'offsetY', -5, 5).name('Vertical Offset').onChange(v => {
        this.game.ghosts.forEach(g => {
            if (g.visualOffset) g.visualOffset.y = v;
        });
    });
    
    // Animation Controls
    const animFolder = this.ghostGui.addFolder('Animation Tester');
    const animParams = {
        playIdle: () => { const g = getGhost(); if(g) g._playAnimation('idle'); },
        playWalk: () => { const g = getGhost(); if(g) g._playAnimation('walk'); },
        playRun: () => { const g = getGhost(); if(g) g._playAnimation('run'); },
        playAttack: () => { const g = getGhost(); if(g) g._playAnimation('attack'); }
    };
    
    animFolder.add(animParams, 'playIdle').name('Play Idle');
    animFolder.add(animParams, 'playWalk').name('Play Walk');
    animFolder.add(animParams, 'playRun').name('Play Run');
    animFolder.add(animParams, 'playAttack').name('Play Attack');
  }
  
  _setupEnvironmentPanel() {
      const folder = this.gui.addFolder('Environment');
      const params = {
          lightIntensity: 1.5,
          fogDensity: 0.002,
          update: () => {
              if (this.game.ambientLight) this.game.ambientLight.intensity = params.lightIntensity;
              if (this.game.scene.fog) this.game.scene.fog.density = params.fogDensity;
          }
      };
      folder.add(params, 'lightIntensity', 0, 5).onChange(params.update);
      folder.add(params, 'fogDensity', 0, 0.1).onChange(params.update);
  }

  _setupExportPanel() {
    const folder = this.gui.addFolder('Export Config');
    const params = {
      copyJSON: () => {
        const data = {
          player: {
            radius: this.game.player.config.radius,
            height: this.game.player.config.height,
            mass: this.game.player.config.mass,
            speed: this.game.player.config.speed
          },
          ghost: {
             radius: this.game.ghosts[0]?.radius,
             height: this.game.ghosts[0]?.height
          }
        };
        const json = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(json).then(() => {
          alert('Config copied to clipboard!');
        });
        console.log('Exported Config:', json);
      }
    };
    folder.add(params, 'copyJSON').name('Copy to Clipboard');
  }
  
  dispose() {
      if (this.gui) this.gui.destroy();
      if (this.ghostGui) this.ghostGui.destroy();
  }
}
