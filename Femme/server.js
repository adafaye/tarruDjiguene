require('dotenv').config();



const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise');
const OpenAI = require('openai');


const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cyclefem-secret-key-2025';

// Configuration OpenAI AMÉLIORÉE
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'votre-clé-api-ici',
    timeout: 30000,
    maxRetries: 2
});

// Configuration MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cyclefem_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connexion MySQL au démarrage
pool.getConnection()
    .then(connection => {
        console.log(' Connexion MySQL réussie');
        connection.release();
    })
    .catch(err => {
        console.error(' Erreur connexion MySQL:', err.message);
        console.log(' Assurez-vous que MySQL est démarré et que la base de données existe');
    });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper functions
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token d\'accès requis' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide' });
        }
        req.user = user;
        next();
    });
}

async function calculatePredictions(userId) {
    try {
        const [cycles] = await pool.query(
            'SELECT * FROM cycles WHERE user_id = ? ORDER BY start_date DESC LIMIT 12',
            [userId]
        );

        if (cycles.length === 0) return null;

        const cycleLengths = [];
        for (let i = 1; i < cycles.length; i++) {
            const prevDate = new Date(cycles[i - 1].start_date);
            const currDate = new Date(cycles[i].start_date);
            const days = Math.floor((prevDate - currDate) / (1000 * 60 * 60 * 24));

            if (days > 0 && days < 60) {
                cycleLengths.push(days);
            }
        }

        const avgCycleLength = cycleLengths.length > 0
            ? cycleLengths.reduce((a, b) => a + b) / cycleLengths.length
            : 28;

        const lastCycle = cycles[0];
        const lastStart = new Date(lastCycle.start_date);

        const nextPeriod = new Date(lastStart);
        nextPeriod.setDate(nextPeriod.getDate() + Math.round(avgCycleLength));

        const ovulation = new Date(nextPeriod);
        ovulation.setDate(ovulation.getDate() - 14);

        const fertileStart = new Date(ovulation);
        fertileStart.setDate(fertileStart.getDate() - 5);

        const fertileEnd = new Date(ovulation);
        fertileEnd.setDate(fertileEnd.getDate() + 1);

        return {
            nextPeriod: nextPeriod.toISOString().split('T')[0],
            ovulation: ovulation.toISOString().split('T')[0],
            fertileWindow: {
                start: fertileStart.toISOString().split('T')[0],
                end: fertileEnd.toISOString().split('T')[0]
            },
            avgCycleLength: Math.round(avgCycleLength)
        };
    } catch (error) {
        console.error('Erreur calcul prédictions:', error);
        return null;
    }
}

function calculatePregnancyRisk(activityDate, predictions) {
    if (!predictions) return 'unknown';

    const activity = new Date(activityDate);
    const fertileStart = new Date(predictions.fertileWindow.start);
    const fertileEnd = new Date(predictions.fertileWindow.end);
    const ovulation = new Date(predictions.ovulation);

    if (activity >= fertileStart && activity <= fertileEnd) {
        const daysDiff = Math.abs((activity - ovulation) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 1) return 'high';
        if (daysDiff <= 2) return 'medium';
        return 'medium';
    }

    return 'low';
}

// FONCTION DE SECOURS POUR RÉPONSES PAR DÉFAUT
function getFallbackResponse(message) {
    if (!message) return "Je suis désolée, je rencontre des difficultés techniques. Comment puis-je vous aider avec votre cycle menstruel ? 🌸";

    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('règles') || lowerMessage.includes('regle') || lowerMessage.includes('menstru')) {
        return `Je comprends que vous avez des questions sur votre cycle menstruel. 

Pour un suivi personnalisé, je vous recommande d'enregistrer vos dates de règles dans l'application. Voici quelques informations générales :

• **Cycle normal** : 21 à 35 jours
• **Règles typiques** : 3 à 7 jours  
• **Phase fertile** : généralement 5 jours avant l'ovulation

Pour des conseils spécifiques, n'hésitez pas à consulter un professionnel de santé.`;
    }

    if (lowerMessage.includes('ovulation') || lowerMessage.includes('fertile') || lowerMessage.includes('fertilité')) {
        return `À propos de l'ovulation et de la fertilité 

**L'ovulation** se produit généralement 14 jours avant le début des prochaines règles. 

**La période fertile** commence 5 jours avant l'ovulation et se termine le jour de l'ovulation.

Pour une estimation précise adaptée à votre cycle, utilisez la fonction de prédiction de l'application avec vos données personnelles.`;
    }

    if (lowerMessage.includes('symptom') || lowerMessage.includes('douleur') || lowerMessage.includes('crampe')) {
        return `Concernant les symptômes menstruels 

Les symptômes courants incluent :
• Crampes abdominales
• Maux de tête
• Changements d'humeur
• Fatigue
• Sensibilité des seins

Si vos symptômes sont sévères ou perturbent votre quotidien, je vous recommande de consulter un gynécologue.`;
    }

    if (lowerMessage.includes('contraception') || lowerMessage.includes('protect') || lowerMessage.includes('grossesse')) {
        return `Pour des questions de contraception et prévention 

L'application peut vous aider à identifier votre période fertile, mais **ne remplace pas une méthode contraceptive**. 

Pour des conseils personnalisés sur la contraception, veuillez consulter un professionnel de santé.`;
    }

    if (lowerMessage.includes('date') || lowerMessage.includes('quand') || lowerMessage.includes('prochain')) {
        return `Pour connaître vos dates importantes 

L'application peut prédire vos prochaines règles, votre ovulation et votre période fertile basée sur votre historique.

**Pour des prédictions précises :**
1. Enregistrez vos dates de règles
2. Remplissez votre historique de cycles
3. Consultez la section "Prédictions"

Vos données personnelles permettront des estimations plus fiables !`;
    }

    return `Je suis désolée, je rencontre actuellement des difficultés techniques. 

En attendant, vous pouvez :
• Enregistrer vos cycles menstruels
•  Consulter vos prédictions de fertilité  
•  Visualiser votre historique

Pour des questions spécifiques concernant votre santé, n'hésitez pas à consulter un professionnel de santé.`;
}

// ROUTES AUTHENTIFICATION
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'Email, mot de passe et nom requis' });
        }

        // Vérifier si l'email existe déjà
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateId();

        await pool.query(
            'INSERT INTO users (id, email, name, password, cycle_length) VALUES (?, ?, ?, ?, ?)',
            [userId, email, name, hashedPassword, 28]
        );

        const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            message: 'Compte créé avec succès',
            token,
            user: { id: userId, email, name, cycleLength: 28 }
        });
    } catch (error) {
        console.error('Erreur register:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email et mot de passe requis' });
        }

        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const user = users[0];
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: 'Connexion réussie',
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                cycleLength: user.cycle_length
            }
        });
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTES PROFIL UTILISATEUR
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, email, name, cycle_length FROM users WHERE id = ?',
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        const user = users[0];
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            cycleLength: user.cycle_length
        });
    } catch (error) {
        console.error('Erreur profile:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, cycleLength } = req.body;

        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name);
        }

        if (cycleLength && cycleLength >= 21 && cycleLength <= 35) {
            updates.push('cycle_length = ?');
            values.push(cycleLength);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
        }

        values.push(req.user.userId);

        await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        const [users] = await pool.query(
            'SELECT id, email, name, cycle_length FROM users WHERE id = ?',
            [req.user.userId]
        );

        res.json({
            message: 'Profil mis à jour',
            user: {
                id: users[0].id,
                email: users[0].email,
                name: users[0].name,
                cycleLength: users[0].cycle_length
            }
        });
    } catch (error) {
        console.error('Erreur update profile:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTES CYCLES MENSTRUELS
app.get('/api/cycles', authenticateToken, async (req, res) => {
    try {
        const [cycles] = await pool.query(
            'SELECT * FROM cycles WHERE user_id = ? ORDER BY start_date DESC',
            [req.user.userId]
        );

        const formattedCycles = cycles.map(cycle => ({
            id: cycle.id,
            startDate: cycle.start_date,
            endDate: cycle.end_date,
            flow: cycle.flow,
            symptoms: (() => {
                try {
                    return cycle.symptoms && cycle.symptoms.trim() !== ""
                        ? JSON.parse(cycle.symptoms)
                        : [];
                } catch (err) {
                    console.error("Erreur de parsing JSON pour symptoms:", err);
                    return [];
                }
            })(),

            notes: cycle.notes,
            createdAt: cycle.created_at
        }));

        const predictions = await calculatePredictions(req.user.userId);

        res.json({
            cycles: formattedCycles,
            predictions
        });
    } catch (error) {
        console.error('Erreur get cycles:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/cycles', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, flow, symptoms, notes } = req.body;

        if (!startDate) {
            return res.status(400).json({ error: 'Date de début requise' });
        }

        const cycleId = generateId();
        const symptomsJson = JSON.stringify(symptoms || []);

        await pool.query(
            'INSERT INTO cycles (id, user_id, start_date, end_date, flow, symptoms, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cycleId, req.user.userId, startDate, endDate || null, flow || 'medium', symptomsJson, notes || null]
        );

        const predictions = await calculatePredictions(req.user.userId);

        res.status(201).json({
            message: 'Cycle enregistré',
            cycle: {
                id: cycleId,
                startDate,
                endDate: endDate || null,
                flow: flow || 'medium',
                symptoms: symptoms || []
            },
            predictions
        });
    } catch (error) {
        console.error('Erreur post cycle:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.put('/api/cycles/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, flow, symptoms, notes } = req.body;

        const updates = [];
        const values = [];

        if (startDate) {
            updates.push('start_date = ?');
            values.push(startDate);
        }
        if (endDate !== undefined) {
            updates.push('end_date = ?');
            values.push(endDate);
        }
        if (flow) {
            updates.push('flow = ?');
            values.push(flow);
        }
        if (symptoms) {
            updates.push('symptoms = ?');
            values.push(JSON.stringify(symptoms));
        }
        if (notes !== undefined) {
            updates.push('notes = ?');
            values.push(notes);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Aucune donnée à mettre à jour' });
        }

        values.push(id, req.user.userId);

        const [result] = await pool.query(
            `UPDATE cycles SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Cycle non trouvé' });
        }

        const predictions = await calculatePredictions(req.user.userId);

        res.json({
            message: 'Cycle mis à jour',
            predictions
        });
    } catch (error) {
        console.error('Erreur update cycle:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/cycles/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query(
            'DELETE FROM cycles WHERE id = ? AND user_id = ?',
            [id, req.user.userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Cycle non trouvé' });
        }

        const predictions = await calculatePredictions(req.user.userId);

        res.json({
            message: 'Cycle supprimé',
            predictions
        });
    } catch (error) {
        console.error('Erreur delete cycle:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTES ACTIVITÉS SEXUELLES
app.get('/api/sexual-activities', authenticateToken, async (req, res) => {
    try {
        const [activities] = await pool.query(
            'SELECT * FROM sexual_activities WHERE user_id = ? ORDER BY activity_date DESC',
            [req.user.userId]
        );

        const formattedActivities = activities.map(activity => ({
            id: activity.id,
            date: activity.activity_date,
            protection: activity.protection,
            pregnancyRisk: activity.pregnancy_risk,
            notes: activity.notes,
            createdAt: activity.created_at
        }));

        res.json({ activities: formattedActivities });
    } catch (error) {
        console.error('Erreur get activities:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/sexual-activities', authenticateToken, async (req, res) => {
    try {
        const { date, protection, notes } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'Date requise' });
        }

        const activityId = generateId();
        const predictions = await calculatePredictions(req.user.userId);
        const risk = calculatePregnancyRisk(date, predictions);

        await pool.query(
            'INSERT INTO sexual_activities (id, user_id, activity_date, protection, pregnancy_risk, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [activityId, req.user.userId, date, protection || false, risk, notes || null]
        );

        res.status(201).json({
            message: 'Activité enregistrée',
            activity: {
                id: activityId,
                date,
                protection: protection || false,
                pregnancyRisk: risk
            }
        });
    } catch (error) {
        console.error('Erreur post activity:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/sexual-activities/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query(
            'DELETE FROM sexual_activities WHERE id = ? AND user_id = ?',
            [id, req.user.userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Activité non trouvée' });
        }

        res.json({ message: 'Activité supprimée' });
    } catch (error) {
        console.error('Erreur delete activity:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTES STATISTIQUES
app.get('/api/statistics', authenticateToken, async (req, res) => {
    try {
        const [cycles] = await pool.query(
            'SELECT * FROM cycles WHERE user_id = ? ORDER BY start_date DESC',
            [req.user.userId]
        );

        if (cycles.length === 0) {
            return res.json({
                totalCycles: 0,
                averageCycleLength: 0,
                averagePeriodLength: 0,
                regularity: 0
            });
        }

        const cycleLengths = [];
        for (let i = 1; i < cycles.length; i++) {
            const prevStart = new Date(cycles[i - 1].start_date);
            const currentStart = new Date(cycles[i].start_date);
            const length = Math.floor((prevStart - currentStart) / (1000 * 60 * 60 * 24));
            if (length > 0 && length < 60) {
                cycleLengths.push(length);
            }
        }

        const periodLengths = cycles
            .filter(cycle => cycle.end_date)
            .map(cycle => {
                const start = new Date(cycle.start_date);
                const end = new Date(cycle.end_date);
                return Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
            });

        const avgCycleLength = cycleLengths.length > 0
            ? cycleLengths.reduce((sum, length) => sum + length, 0) / cycleLengths.length
            : 0;

        const avgPeriodLength = periodLengths.length > 0
            ? periodLengths.reduce((sum, length) => sum + length, 0) / periodLengths.length
            : 0;

        let regularCycles = 0;
        if (cycleLengths.length > 0) {
            regularCycles = cycleLengths.filter(length =>
                Math.abs(length - avgCycleLength) <= 2
            ).length;
        }

        const regularity = cycleLengths.length > 0
            ? (regularCycles / cycleLengths.length) * 100
            : 0;

        res.json({
            totalCycles: cycles.length,
            averageCycleLength: Math.round(avgCycleLength * 10) / 10,
            averagePeriodLength: Math.round(avgPeriodLength * 10) / 10,
            regularity: Math.round(regularity)
        });
    } catch (error) {
        console.error('Erreur statistics:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTE IA CHATBOT - VERSION CORRIGÉE ET AMÉLIORÉE
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Message requis' });
        }

        // VÉRIFICATION CRITIQUE : Clé API configurée ?
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'votre-clé-api-ici') {
            console.log(' Clé API OpenAI non configurée - Utilisation du mode secours');
            return res.json({
                message: 'Réponse générée (mode secours)',
                response: getFallbackResponse(message),
                fallback: true,
                timestamp: new Date().toISOString()
            });
        }

        // Récupérer l'historique de l'utilisatrice pour contexte
        const [cycles] = await pool.query(
            'SELECT * FROM cycles WHERE user_id = ? ORDER BY start_date DESC LIMIT 5',
            [req.user.userId]
        );

        const [user] = await pool.query(
            'SELECT name, cycle_length FROM users WHERE id = ?',
            [req.user.userId]
        );

        const predictions = await calculatePredictions(req.user.userId);

        // Construire le contexte pour l'IA
        const context = `Tu es une assistante santé spécialisée dans le cycle menstruel féminin et la santé reproductive.

Informations sur l'utilisatrice :
- Nom: ${user[0]?.name || 'Utilisatrice'}
- Durée moyenne du cycle: ${user[0]?.cycle_length || 28} jours
- Nombre de cycles enregistrés: ${cycles.length}
${predictions ? `- Prochaines règles prévues: ${predictions.nextPeriod}
- Ovulation prévue: ${predictions.ovulation}
- Période fertile: ${predictions.fertileWindow.start} au ${predictions.fertileWindow.end}` : 'Aucune prédiction disponible'}

Instructions :
- Réponds de manière empathique, informative et rassurante
- Donne des conseils pratiques et basés sur la science
- Si la question nécessite un avis médical professionnel, recommande de consulter un gynécologue ou médecin
- Utilise un ton chaleureux et accessible
- Sois concise mais complète dans tes réponses
- N'invente jamais des informations médicales
- Rappelle toujours de consulter un professionnel pour les problèmes sérieux`;

        console.log(' Tentative d\'appel OpenAI...');

        // Appel à l'API OpenAI avec meilleure gestion d'erreur
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: context },
                { role: "user", content: message.trim() }
            ],
            temperature: 0.7,
            max_tokens: 500,
            timeout: 25000 // 25 secondes max
        });

        const aiResponse = completion.choices[0].message.content;
        console.log(' Réponse OpenAI reçue');

        // Optionnel : Sauvegarder l'historique des conversations
        try {
            const chatId = generateId();
            await pool.query(
                'INSERT INTO chat_history (id, user_id, message, response, created_at) VALUES (?, ?, ?, ?, NOW())',
                [chatId, req.user.userId, message, aiResponse]
            );
        } catch (dbError) {
            console.log(' Historique non sauvegardé:', dbError.message);
        }

        res.json({
            message: 'Réponse générée',
            response: aiResponse,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(' Erreur IA chat détaillée:', error);

        // Gestion d'erreur AMÉLIORÉE - Toujours retourner une réponse
        let userMessage = 'Service IA temporairement indisponible';
        let fallbackResponse = getFallbackResponse(req.body?.message);

        if (error.code === 'insufficient_quota') {
            userMessage = 'Quota API dépassé';
            console.log(' Quota OpenAI épuisé');
        } else if (error.code === 'invalid_api_key') {
            userMessage = 'Clé API invalide';
            console.log(' Clé API OpenAI invalide');
        } else if (error.name === 'TimeoutError' || error.code === 'TIMEOUT') {
            userMessage = 'Temps de réponse dépassé';
            console.log(' Timeout OpenAI');
        } else if (error.message && error.message.includes('API key')) {
            userMessage = 'Problème de configuration API';
            console.log(' Problème configuration API');
        } else if (error.message && error.message.includes('connect')) {
            userMessage = 'Impossible de se connecter au service IA';
            console.log(' Erreur connexion OpenAI');
        }

        // Retourner une réponse utilisable même en cas d'erreur
        res.json({
            message: userMessage,
            response: fallbackResponse,
            fallback: true,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour récupérer l'historique des conversations
app.get('/api/chat/history', authenticateToken, async (req, res) => {
    try {
        const [history] = await pool.query(
            'SELECT id, message, response, created_at FROM chat_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.userId]
        );

        res.json({
            history: history.map(chat => ({
                id: chat.id,
                message: chat.message,
                response: chat.response,
                createdAt: chat.created_at
            }))
        });
    } catch (error) {
        console.error('Erreur get chat history:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ROUTES SANTÉ
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'CycleFem API',
        database: 'MySQL',
        ai: process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'votre-clé-api-ici' ? 'OpenAI GPT-4o-mini' : 'Mode secours',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Démarrer le serveur
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n CycleFem API Server');
    console.log(` Serveur démarré sur le port ${PORT}`);
    console.log(` URL: http://localhost:${PORT}`);
    console.log(`  Base de données: MySQL`);
    console.log(` IA: ${process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'votre-clé-api-ici' ? 'OpenAI GPT-4o-mini' : 'Mode secours activé'}`);
    console.log(` Environnement: ${process.env.NODE_ENV || 'développement'}`);

});