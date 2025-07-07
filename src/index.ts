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
  avatar_url?: string;
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
  private _currentModal: HTMLDivElement | null = null;
  private _hideModalTimeout: NodeJS.Timeout | null = null;

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
      const avatar_url = user.avatar_url || user.avatarUrl || '';
      const color = user.color || generateUserColor(name);
      const initials = generateInitials(name);
      
      currentCollaborators.set(clientId, {
        name,
        initials,
        email,
        avatar_url,
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
        avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
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
        avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
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
    
    if (collaborator.avatar_url) {
      // Use avatar image
      userIcon.classList.add('jp-DocumentCollaborators-userIcon-avatar');
      const avatarImage = document.createElement('img');
      avatarImage.className = 'jp-DocumentCollaborators-avatar';
      avatarImage.src = collaborator.avatar_url;
      avatarImage.alt = `${collaborator.name} avatar`;
      
      // Handle image load errors by falling back to initials
      avatarImage.addEventListener('error', () => {
        userIcon.removeChild(avatarImage);
        userIcon.classList.remove('jp-DocumentCollaborators-userIcon-avatar');
        userIcon.style.backgroundColor = collaborator.color;
        
        const initialsElement = document.createElement('div');
        initialsElement.className = 'jp-DocumentCollaborators-initials';
        initialsElement.textContent = collaborator.initials;
        userIcon.appendChild(initialsElement);
      });
      
      userIcon.appendChild(avatarImage);
    } else {
      // Fall back to initials
      userIcon.style.backgroundColor = collaborator.color;
      
      const initialsElement = document.createElement('div');
      initialsElement.className = 'jp-DocumentCollaborators-initials';
      initialsElement.textContent = collaborator.initials;
      userIcon.appendChild(initialsElement);
    }
    
    // Add hover effects for modal display
    userIcon.addEventListener('mouseenter', (event) => {
      this._showCollaboratorModal(collaborator, event.target as HTMLElement);
    });
    
    userIcon.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });
    
    // Remove the default title since we're using a custom modal
    userIcon.removeAttribute('title');
    
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
    
    // Add hover effects for more icon modal
    moreIcon.addEventListener('mouseenter', (event) => {
      this._showMoreModal(event.target as HTMLElement);
    });
    
    moreIcon.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });
    
    // Remove the default title since we're using a custom modal
    moreIcon.removeAttribute('title');
    
    return moreIcon;
  }

  private _showCollaboratorModal(collaborator: ICollaborator, targetElement: HTMLElement): void {
    this._clearHideModalTimeout();
    this._hideCurrentModal();
    
    const modal = document.createElement('div');
    modal.className = 'jp-DocumentCollaborators-modal';
    
    // Create modal content
    const content = document.createElement('div');
    content.className = 'jp-DocumentCollaborators-modal-content';
    
    // Create header with user icon and info
    const headerElement = document.createElement('div');
    headerElement.className = 'jp-DocumentCollaborators-modal-header';
    
    // User icon
    const userIconElement = document.createElement('div');
    userIconElement.className = 'jp-DocumentCollaborators-modal-userIcon';
    
    if (collaborator.avatar_url) {
      // Use avatar image
      userIconElement.classList.add('jp-DocumentCollaborators-modal-userIcon-avatar');
      const avatarImage = document.createElement('img');
      avatarImage.className = 'jp-DocumentCollaborators-modal-avatar';
      avatarImage.src = collaborator.avatar_url;
      avatarImage.alt = `${collaborator.name} avatar`;
      
      // Handle image load errors by falling back to initials
      avatarImage.addEventListener('error', () => {
        userIconElement.removeChild(avatarImage);
        userIconElement.classList.remove('jp-DocumentCollaborators-modal-userIcon-avatar');
        userIconElement.style.backgroundColor = collaborator.color;
        
        const initialsElement = document.createElement('div');
        initialsElement.className = 'jp-DocumentCollaborators-modal-initials';
        initialsElement.textContent = collaborator.initials;
        userIconElement.appendChild(initialsElement);
      });
      
      userIconElement.appendChild(avatarImage);
    } else {
      // Fall back to initials
      userIconElement.style.backgroundColor = collaborator.color;
      
      const initialsElement = document.createElement('div');
      initialsElement.className = 'jp-DocumentCollaborators-modal-initials';
      initialsElement.textContent = collaborator.initials;
      userIconElement.appendChild(initialsElement);
    }
    
    headerElement.appendChild(userIconElement);
    
    // User info container
    const userInfoElement = document.createElement('div');
    userInfoElement.className = 'jp-DocumentCollaborators-modal-userInfo';
    
    // User name
    const nameElement = document.createElement('div');
    nameElement.className = 'jp-DocumentCollaborators-modal-name';
    nameElement.textContent = collaborator.name;
    userInfoElement.appendChild(nameElement);
    
    // User email (if available)
    if (collaborator.email) {
      const emailElement = document.createElement('div');
      emailElement.className = 'jp-DocumentCollaborators-modal-email';
      emailElement.textContent = collaborator.email;
      userInfoElement.appendChild(emailElement);
    }
    
    headerElement.appendChild(userInfoElement);
    content.appendChild(headerElement);
    
    modal.appendChild(content);
    
    // Add hover handlers to keep modal visible
    modal.addEventListener('mouseenter', () => {
      this._clearHideModalTimeout();
    });
    
    modal.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });
    
    // Position and show modal
    this._positionAndShowModal(modal, targetElement);
  }
  
  private _showMoreModal(targetElement: HTMLElement): void {
    this._clearHideModalTimeout();
    this._hideCurrentModal();
    
    const hiddenCollaborators = Array.from(this._collaborators.values()).slice(this._maxVisibleCollaborators);
    
    const modal = document.createElement('div');
    modal.className = 'jp-DocumentCollaborators-modal jp-DocumentCollaborators-modal-more';
    
    // Create modal content
    const content = document.createElement('div');
    content.className = 'jp-DocumentCollaborators-modal-content';
    
    // Title
    const titleElement = document.createElement('div');
    titleElement.className = 'jp-DocumentCollaborators-modal-title';
    titleElement.textContent = 'Additional Collaborators';
    content.appendChild(titleElement);
    
    // List of hidden collaborators
    hiddenCollaborators.forEach(collaborator => {
      const collaboratorElement = document.createElement('div');
      collaboratorElement.className = 'jp-DocumentCollaborators-modal-collaborator';
      
      const nameElement = document.createElement('div');
      nameElement.className = 'jp-DocumentCollaborators-modal-name';
      nameElement.textContent = collaborator.name;
      collaboratorElement.appendChild(nameElement);
      
      if (collaborator.email) {
        const emailElement = document.createElement('div');
        emailElement.className = 'jp-DocumentCollaborators-modal-email';
        emailElement.textContent = collaborator.email;
        collaboratorElement.appendChild(emailElement);
      }
      
      content.appendChild(collaboratorElement);
    });
    
    modal.appendChild(content);
    
    // Add hover handlers to keep modal visible
    modal.addEventListener('mouseenter', () => {
      this._clearHideModalTimeout();
    });
    
    modal.addEventListener('mouseleave', () => {
      this._scheduleHideModal();
    });
    
    // Position and show modal
    this._positionAndShowModal(modal, targetElement);
  }
  
  private _positionAndShowModal(modal: HTMLDivElement, targetElement: HTMLElement): void {
    // Add modal to document body
    document.body.appendChild(modal);
    this._currentModal = modal;
    
    // Get target element position
    const targetRect = targetElement.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    
    // Position modal above the target element
    let left = targetRect.left + (targetRect.width / 2) - (modalRect.width / 2);
    let top = targetRect.top - modalRect.height - 8; // 8px gap
    
    // Ensure modal stays within viewport
    const padding = 8;
    left = Math.max(padding, Math.min(left, window.innerWidth - modalRect.width - padding));
    
    // If modal would be cut off at the top, show it below the target
    if (top < padding) {
      top = targetRect.bottom + 8;
    }
    
    modal.style.left = `${left}px`;
    modal.style.top = `${top}px`;
    
    // Trigger animation
    requestAnimationFrame(() => {
      modal.classList.add('jp-DocumentCollaborators-modal-visible');
    });
  }
  
  private _scheduleHideModal(): void {
    this._clearHideModalTimeout();
    this._hideModalTimeout = setTimeout(() => {
      this._hideCurrentModal();
    }, 200); // Small delay to allow moving to modal
  }
  
  private _clearHideModalTimeout(): void {
    if (this._hideModalTimeout) {
      clearTimeout(this._hideModalTimeout);
      this._hideModalTimeout = null;
    }
  }
  
  private _hideCurrentModal(): void {
    if (this._currentModal) {
      this._currentModal.classList.remove('jp-DocumentCollaborators-modal-visible');
      setTimeout(() => {
        if (this._currentModal && this._currentModal.parentNode) {
          this._currentModal.parentNode.removeChild(this._currentModal);
        }
        this._currentModal = null;
      }, 200); // Match CSS transition duration
    }
  }

  /**
   * Dispose of the widget resources
   */
  dispose(): void {
    if (this._awareness) {
      this._awareness.off('change', this._onAwarenessChange.bind(this));
    }
    this._clearHideModalTimeout();
    this._hideCurrentModal();
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
