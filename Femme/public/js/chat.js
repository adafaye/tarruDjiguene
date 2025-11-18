class ChatBot {
    constructor() {
        this.chatContainer = document.getElementById('chat-container');
        this.chatInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-button');
        
        if (this.chatContainer && this.chatInput && this.sendButton) {
            this.initializeEventListeners();
            console.log(' ChatBot initialisé avec succès');
        } else {
            console.error('Éléments HTML du chat non trouvés');
        }
    }

    initializeEventListeners() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        
        this.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        console.log(' Event listeners initialisés');
    }

    async sendMessage() {
        const message = this.chatInput.value.trim();
        
        if (!message) {
            console.log(' Message vide ignoré');
            return;
        }

        console.log(' Envoi du message:', message);

        // Afficher le message de l'utilisateur
        this.addMessage('user', message);
        this.chatInput.value = '';
        this.setLoadingState(true);

        try {
            const token = this.getAuthToken();
            
            if (!token) {
                throw new Error('Veuillez vous connecter pour utiliser le chatbot');
            }

            console.log(' Envoi de la requête API...');
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message })
            });

            console.log(' Réponse reçue, statut:', response.status);

            const data = await response.json();
            console.log(' Données reçues:', data);

            if (!response.ok) {
                throw new Error(data.error || `Erreur ${response.status}: ${response.statusText}`);
            }

            // Afficher la réponse
            this.addMessage('assistant', data.response);
            
            // Afficher un indicateur discret si mode secours
            if (data.fallback) {
                this.showFallbackIndicator();
                console.log(' Mode secours activé');
            } else {
                console.log(' Réponse OpenAI reçue');
            }

        } catch (error) {
            console.error(' Erreur chat:', error);
            
            let errorMessage = "Je rencontre des difficultés techniques. ";
            
            if (error.message.includes('connecter')) {
                errorMessage += "Veuillez vous connecter pour utiliser le chatbot.";
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage += "Problème de connexion au serveur. Vérifiez votre connexion internet.";
            } else {
                errorMessage += "Voici quelques informations qui pourraient vous aider :<br><br>";
                errorMessage += " <strong>Pour connaître vos prochaines règles :</strong><br>";
                errorMessage += "• Consultez la section 'Prédictions' dans votre tableau de bord<br>";
                errorMessage += "• Vérifiez que vous avez bien enregistré vos dernières règles<br>";
                errorMessage += "• L'application utilise votre historique pour des prévisions précises";
            }
            
            this.addMessage('assistant', errorMessage);

        } finally {
            this.setLoadingState(false);
            console.log(' État de chargement désactivé');
        }
    }

    getAuthToken() {
        // Essayer plusieurs emplacements possibles pour le token
        return localStorage.getItem('token') || 
               sessionStorage.getItem('token') ||
               localStorage.getItem('cyclefem_token') ||
               sessionStorage.getItem('cyclefem_token');
    }

    addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}-message`;
        
        const timestamp = new Date().toLocaleTimeString('fr-FR', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-text">${text}</div>
                <div class="message-time">${timestamp}</div>
            </div>
        `;

        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        console.log(` Message ${sender} ajouté`);
    }

    showFallbackIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'fallback-indicator';
        indicator.textContent = ' Mode assistance de base activé';
        this.chatContainer.appendChild(indicator);
        this.scrollToBottom();
    }

    setLoadingState(loading) {
        if (loading) {
            this.sendButton.disabled = true;
            this.sendButton.innerHTML = '<div class="loading"></div>';
            this.chatInput.disabled = true;
            this.chatInput.placeholder = 'Envoi en cours...';
            console.log(' État de chargement activé');
        } else {
            this.sendButton.disabled = false;
            this.sendButton.textContent = 'Envoyer';
            this.chatInput.disabled = false;
            this.chatInput.placeholder = 'Posez votre question...';
            this.chatInput.focus();
            console.log(' État de chargement désactivé');
        }
    }

    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
}

// Initialisation automatique quand la page est chargée
document.addEventListener('DOMContentLoaded', function() {
    console.log(' DOM chargé, initialisation du chatbot...');
    window.chatBot = new ChatBot();
});

// Fonction utilitaire pour tester le chatbot
window.testChatBot = function() {
    console.log(' Test du chatbot...');
    if (window.chatBot) {
        window.chatBot.addMessage('assistant', 'Ceci est un message de test !');
    } else {
        console.error('ChatBot non initialisé');
    }
};