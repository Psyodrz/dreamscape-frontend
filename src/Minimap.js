import * as THREE from 'three';

export class Minimap {
  constructor(scene, camera, mazeData) {
    this.scene = scene;
    this.camera = camera;
    this.mazeData = mazeData;
    
    this.visible = true;
    this.size = 200;
    this.padding = 20;
    
    this.playerMarkerSize = 8;
    this.ghostMarkerSize = 6;
    
    this._createMinimapElements();
  }
  
  _createMinimapElements() {
    // Check for mobile and detect landscape orientation
    const isMobile = window.innerWidth < 768 || window.innerHeight < 500;
    const isLandscape = window.innerWidth > window.innerHeight;
    
    // Use larger size for mobile landscape
    if (isMobile && isLandscape) {
      this.size = 180; // Increased from 100
      this.padding = 15;
      this.playerMarkerSize = 14; 
      this.ghostMarkerSize = 7;
    } else if (isMobile) {
      this.size = 200; // Increased from 150
      this.padding = 15;
      this.playerMarkerSize = 16;
      this.ghostMarkerSize = 8;
    } else {
      this.size = 350; // Increased from 300
      this.padding = 30;
      this.playerMarkerSize = 20;
      this.ghostMarkerSize = 10;
    }

    // Create container
    this.container = document.createElement('div');
    this.container.style.position = 'fixed';
    
    // Move to TOP RIGHT to avoid button overlap (below hearts)
    const topOffset = isMobile ? 50 : 60; // Space for hearts
    this.container.style.top = `${topOffset}px`; 
    this.container.style.right = `${this.padding}px`;
    
    this.container.style.width = `${this.size}px`;
    this.container.style.height = `${this.size}px`;
    this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // More transparent
    this.container.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    this.container.style.borderRadius = '8px';
    this.container.style.overflow = 'hidden';
    this.container.style.zIndex = '1000';
    document.body.appendChild(this.container);
    
    // Create canvas for maze
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Draw maze
    this._drawMaze();
    
    // Create player marker (Arrow)
    this.playerMarker = document.createElement('div');
    this.playerMarker.style.position = 'absolute';
    this.playerMarker.style.width = '0';
    this.playerMarker.style.height = '0';
    this.playerMarker.style.borderLeft = `${this.playerMarkerSize / 2}px solid transparent`;
    this.playerMarker.style.borderRight = `${this.playerMarkerSize / 2}px solid transparent`;
    this.playerMarker.style.borderBottom = `${this.playerMarkerSize}px solid #4cc9f0`;
    this.playerMarker.style.transformOrigin = 'center';
    this.playerMarker.style.transform = 'translate(-50%, -50%)';
    this.playerMarker.style.filter = 'drop-shadow(0 0 2px #4cc9f0)';
    this.container.appendChild(this.playerMarker);
    
    // Ghost markers array
    this.ghostMarkers = [];
  }
  
  _drawMaze() {
    const { maze, width, height, colors, startPos, endPos } = this.mazeData;
    
    const cellWidth = this.size / width;
    const cellHeight = this.size / height;
    
    // Clear canvas
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0)';
    this.ctx.clearRect(0, 0, this.size, this.size);
    
    // Draw cells
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (maze[y][x] === 1) {
          // Wall
          this.ctx.fillStyle = 'rgba(100, 100, 120, 0.8)';
        } else {
          // Path
          this.ctx.fillStyle = 'rgba(40, 40, 50, 0.5)';
        }
        
        this.ctx.fillRect(
          x * cellWidth,
          y * cellHeight,
          cellWidth + 0.5,
          cellHeight + 0.5
        );
      }
    }
    
    // Draw start marker
    this.ctx.fillStyle = '#48bb78';
    this.ctx.beginPath();
    this.ctx.arc(
      (startPos.x + 0.5) * cellWidth,
      (startPos.y + 0.5) * cellHeight,
      cellWidth * 0.4,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
    
    // Draw end marker
    this.ctx.fillStyle = '#f56565';
    this.ctx.beginPath();
    this.ctx.arc(
      (endPos.x + 0.5) * cellWidth,
      (endPos.y + 0.5) * cellHeight,
      cellWidth * 0.4,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
  }
  
  updatePlayerPosition(worldX, worldZ, rotation) {
    if (!this.visible) return;
    
    const { width, height, cellSize } = this.mazeData;
    
    // Convert world position to minimap position
    const mapX = (worldX / (width * cellSize)) * this.size;
    const mapY = (worldZ / (height * cellSize)) * this.size;
    
    this.playerMarker.style.left = `${mapX}px`;
    this.playerMarker.style.top = `${mapY}px`;
    
    // Apply rotation (Arrow points up by default, so we rotate it)
    // Assuming rotation is in radians. CSS rotate is clockwise, standard math is CCW.
    // We negate it to match.
    this.playerMarker.style.transform = `translate(-50%, -50%) rotate(${-rotation}rad)`;
  }
  
  updateGhostPositions(ghostPositions) {
    if (!this.visible) return;
    
    // Remove excess markers
    while (this.ghostMarkers.length > ghostPositions.length) {
      const marker = this.ghostMarkers.pop();
      this.container.removeChild(marker);
    }
    
    // Add new markers if needed
    while (this.ghostMarkers.length < ghostPositions.length) {
      const marker = document.createElement('div');
      marker.style.position = 'absolute';
      marker.style.width = `${this.ghostMarkerSize}px`;
      marker.style.height = `${this.ghostMarkerSize}px`;
      marker.style.backgroundColor = '#ff6b6b';
      marker.style.borderRadius = '50%';
      marker.style.transform = 'translate(-50%, -50%)';
      marker.style.boxShadow = '0 0 5px #ff6b6b';
      this.container.appendChild(marker);
      this.ghostMarkers.push(marker);
    }
    
    // Update marker positions
    const { width, height, cellSize } = this.mazeData;
    
    for (let i = 0; i < ghostPositions.length; i++) {
      const ghost = ghostPositions[i];
      const mapX = (ghost.x / (width * cellSize)) * this.size;
      const mapY = (ghost.z / (height * cellSize)) * this.size;
      
      this.ghostMarkers[i].style.left = `${mapX}px`;
      this.ghostMarkers[i].style.top = `${mapY}px`;
    }
  }
  
  toggleVisibility() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? 'block' : 'none';
  }
  
  dispose() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
