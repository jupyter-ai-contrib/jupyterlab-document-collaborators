import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { IDocumentManager } from '@jupyterlab/docmanager';

import { Widget } from '@lumino/widgets';

import { DocumentRegistry } from '@jupyterlab/docregistry';

import { IDisposable } from '@lumino/disposable';

import { Awareness } from 'y-protocols/awareness';

import { Toolbar } from '@jupyterlab/ui-components';


interface ICollaborator {
  name: string;
  initials: string;
  email?: string;
  color: string;
  clientId: number;
}

/**
 * Generate a consistent color for a user based on their name
 */
function generateUserColor(name: string): string {
  const colors = [
    '#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336',
    '#009688', '#795548', '#607D8B', '#E91E63', '#3F51B5',
    '#00BCD4', '#8BC34A', '#FFC107', '#FF5722', '#9E9E9E'
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    const char = name.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Generate initials from a name
 */
function generateInitials(name: string): string {
  if (!name) return '??';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Lumino widget for displaying document collaborators
 */
class DocumentCollaboratorsWidget extends Widget {
  private _collaborators: Map<number, ICollaborator> = new Map();
  private _maxVisibleCollaborators = 3;
  private _awareness: Awareness | null = null;
  private _sharedModel: any = null;

  constructor(context?: DocumentRegistry.IContext<any>) {
    super();
    this.addClass('jp-DocumentCollaborators');
    
    if (context) {
      this._connectToAwareness(context);
    } else {
      // Fallback to mock data if no context
      this._setupMockCollaborators();
    }
    
    this._renderCollaborators();
  }

  private _connectToAwareness(context: DocumentRegistry.IContext<any>): void {
    // Wait for the context to be ready
    context.ready.then(() => {
      if (context.model && 'sharedModel' in context.model) {
        this._sharedModel = (context.model as any).sharedModel;
        
        if (this._sharedModel && 'awareness' in this._sharedModel) {
          this._awareness = (this._sharedModel as any).awareness as Awareness;
          
          // Listen for awareness changes
          if (this._awareness) {
            this._awareness.on('change', this._onAwarenessChange.bind(this));
            
            // Initial load of current collaborators
            this._updateCollaboratorsFromAwareness();
          }
        }
      }
    }).catch(error => {
      console.warn('Failed to connect to collaboration awareness:', error);
      this._setupMockCollaborators();
    });
  }

  private _onAwarenessChange(): void {
    this._updateCollaboratorsFromAwareness();
    this._renderCollaborators();
  }

  private _updateCollaboratorsFromAwareness(): void {
    if (!this._awareness) {
      return;
    }

    const currentCollaborators = new Map<number, ICollaborator>();
    const awarenessStates = this._awareness.getStates();
    
    awarenessStates.forEach((state: any, clientId: number) => {
      // Skip our own client
      if (clientId === this._awareness!.clientID) {
        return;
      }
      
      // Extract user information from awareness state
      const user = state.user || {};
      const name = user.name || user.displayName || `User ${clientId}`;
      const email = user.email || '';
      const color = user.color || generateUserColor(name);
      const initials = generateInitials(name);
      
      currentCollaborators.set(clientId, {
        name,
        initials,
        email,
        color,
        clientId
      });
    });
    
    this._collaborators = currentCollaborators;
  }

  private _setupMockCollaborators(): void {
    // Fallback mock data for testing/demo purposes
    const mockCollaborators: ICollaborator[] = [
      {
        name: 'Sarah Chen',
        initials: 'SC',
        email: 'sarah.chen@example.com',
        color: '#4CAF50',
        clientId: 1
      },
      {
        name: 'John Doe',
        initials: 'JD',
        email: 'john.doe@example.com',
        color: '#2196F3',
        clientId: 2
      },
      {
        name: 'Alice Smith',
        initials: 'AS',
        email: 'alice.smith@example.com',
        color: '#FF9800',
        clientId: 3
      }
    ];
    
    this._collaborators.clear();
    mockCollaborators.forEach(collaborator => {
      this._collaborators.set(collaborator.clientId, collaborator);
    });
  }

  private _renderCollaborators(): void {
    this.node.innerHTML = '';
    
    const collaborators = Array.from(this._collaborators.values());
    const visibleCollaborators = collaborators.slice(0, this._maxVisibleCollaborators);
    const remainingCount = Math.max(0, collaborators.length - this._maxVisibleCollaborators);
    
    // Create overlapping user icons
    visibleCollaborators.forEach((collaborator, index) => {
      const userIcon = this._createUserIcon(collaborator, index);
      this.node.appendChild(userIcon);
    });
    
    // Add "+N more" icon if there are additional collaborators
    if (remainingCount > 0) {
      const moreIcon = this._createMoreIcon(remainingCount, visibleCollaborators.length);
      this.node.appendChild(moreIcon);
    }
    
    // Update tooltip
    if (collaborators.length > 0) {
      const names = collaborators.map(c => c.name).join(', ');
      this.node.title = `Collaborators: ${names}`;
      this.removeClass('empty');
    } else {
      this.node.title = 'No active collaborators';
      this.addClass('empty');
    }
  }

  private _createUserIcon(collaborator: ICollaborator, index: number): HTMLDivElement {
    const userIcon = document.createElement('div');
    userIcon.className = `jp-DocumentCollaborators-userIcon position-${index}`;
    
    // Set dynamic background color (can't be in CSS)
    userIcon.style.backgroundColor = collaborator.color;
    
    // Add user initials
    const initialsElement = document.createElement('div');
    initialsElement.className = 'jp-DocumentCollaborators-initials';
    initialsElement.textContent = collaborator.initials;
    userIcon.appendChild(initialsElement);
    
    // Status indicator removed
    
    // Add hover effects with proper z-index management
    userIcon.addEventListener('mouseenter', () => {
      // z-index is handled by CSS :hover rule
    });
    
    userIcon.addEventListener('mouseleave', () => {
      // Reset handled by CSS
    });
    
    // Add click handler
    userIcon.addEventListener('click', () => this._onCollaboratorClicked(collaborator));
    userIcon.title = collaborator.name;
    
    return userIcon;
  }

  private _createMoreIcon(remainingCount: number, index: number): HTMLDivElement {
    const moreIcon = document.createElement('div');
    moreIcon.className = `jp-DocumentCollaborators-userIcon jp-DocumentCollaborators-moreIcon position-${index}`;
    
    // Add "+N" text
    const textElement = document.createElement('div');
    textElement.className = 'jp-DocumentCollaborators-moreText';
    textElement.textContent = `+${remainingCount}`;
    moreIcon.appendChild(textElement);
    
    // Add click handler
    moreIcon.addEventListener('click', () => this._onMoreClicked());
    moreIcon.title = `${remainingCount} more collaborator${remainingCount > 1 ? 's' : ''}`;
    
    return moreIcon;
  }

  private _onCollaboratorClicked(collaborator: ICollaborator): void {
    console.log('Collaborator clicked:', collaborator.name);
    const emailInfo = collaborator.email ? `\nEmail: ${collaborator.email}` : '';
    alert(`Collaborator: ${collaborator.name}${emailInfo}\nClient ID: ${collaborator.clientId}`);
  }

  private _onMoreClicked(): void {
    const hiddenCollaborators = Array.from(this._collaborators.values()).slice(this._maxVisibleCollaborators);
    const names = hiddenCollaborators.map(c => c.name).join('\n');
    alert(`Additional Collaborators:\n\n${names}`);
  }

  /**
   * Dispose of the widget resources
   */
  dispose(): void {
    if (this._awareness) {
      this._awareness.off('change', this._onAwarenessChange.bind(this));
    }
    super.dispose();
  }
}

/**
 * A widget extension that adds a collaborators widget to document toolbars.
 */
class CollaboratorsExtension implements DocumentRegistry.IWidgetExtension<any, any> {
  /**
   * Create a new extension for the document widget.
   */
  createNew(
    panel: any,
    context: DocumentRegistry.IContext<any>
  ): IDisposable {
    const collaboratorsWidget = new DocumentCollaboratorsWidget(context);
    let toolbar: Toolbar = panel.toolbar;
    // Add the widget to the document toolbar - place before kernel status
    if (!toolbar.insertAfter('spacer', 'collaborators', collaboratorsWidget)) {
      toolbar.addItem('collaborators', collaboratorsWidget )
    }
    return {
      dispose: () => {
        collaboratorsWidget.dispose();
      },
      isDisposed: false
    };
  }
}

/**
 * Initialization data for the jupyterlab-document-collaborators extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-document-collaborators:plugin',
  description: 'A JupyterLab extension for showing collaborators at the top of a document',
  autoStart: true,
  requires: [IDocumentManager],
  activate: (app: JupyterFrontEnd, docManager: IDocumentManager) => {
    console.log('JupyterLab extension jupyterlab-document-collaborators is activated!');
    
    // Create the extension
    const extension = new CollaboratorsExtension();
    
    // Register the extension with the document registry for all document types
    app.docRegistry.addWidgetExtension('Notebook', extension);
    
    console.log('Document collaborators extension registered!');
  }
};

export default plugin;
