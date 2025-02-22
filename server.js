import express from 'express';
import bodyParser from 'body-parser';
import connectPgSimple from 'connect-pg-simple';
import pkg from 'pg'; 
import cron from 'node-cron';
import { Telegraf } from 'telegraf'; 
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'express-session'
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import path from 'path';
dotenv.config();
const { Pool } = pkg
const app = express();
const port = process.env.PORT || 4000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const pgSession = connectPgSimple(session);

console.log(process.env.DATABASE_URL);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Use the environment variable
    ssl: {
        rejectUnauthorized: false, // Required
    },
});
pool.connect()
    .then(() => {
        console.log('Connected to the database successfully');
    })
    .catch(err => {
        console.error('Database connection error:', err);
    });

// const myApp='https://a26b-197-211-63-16.ngrok-free.app';
const myApp ='https://diuvel-2.onrender.com';
app.use(bodyParser.urlencoded({ extended: true }));

console.log(process.env.NODE_ENV)
if(process.env.NODE_ENV ==='production'){
    app.use(express.static(join(__dirname, '/dist')));
}


// app.use(cors({
//     origin: '*', // Allow
//     methods: ['GET', 'POST'],
//     credentials: true // If you're sending cookies or authentication headers
// }));
app.use(express.json())
app.use(express.static('public'));
app.use(session({
    store: new pgSession({
        pool: pool, // Use your PostgreSQL pool
        tableName: 'session', // Create a table called 'session' to store session data
    }),
    secret: process.env.SECRET_KEY, // Replace with your own secret
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1 * 24 * 60 * 60 * 1000,
        secure: true, // Set
        sameSite: 'None',
    }}));

const bot = new Telegraf(process.env.TELEGRAM_BOT_API_KEY);
bot.start((ctx) => {
    console.log('Received start command')
    ctx.reply('Hey, Welcome to Diuvel! Tap on the coin and see your balance rise. Diuvel is a Decentralized Exchange on the TON Blockchain. The biggest part of Diuvel Token distribution will occur among the players here. Got friends, relatives, co-workers? Bring them all into the game.More buddies, more coins. Join our telegram community', {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Launch', web_app: { url: `${myApp}/startapp` } }],
                [{ text: 'Join telegram',  url: "https://t.me/duivelcoin"  }],
            ],
        },
    });
});

bot.telegram.setWebhook(`${myApp}/bot${process.env.TELEGRAM_BOT_API_KEY}`);
app.use(bot.webhookCallback(`${myApp}/bot${process.env.TELEGRAM_BOT_API_KEY}`));

bot.telegram.getWebhookInfo().then(console.log);
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
// Start the Telegraf 
bot.launch()
    .then(() => {
        console.log('Telegram bot is running');
    })
    .catch((error) => {
        console.error('Error launching the bot:', error);
    });



// Login and User Creation Endpoint
app.post('/startapp', async (req, res) => {
  const { username, first_name, id, referrerId } = req.body;

  if (!username || !first_name || !id) {
    return res.status(400).json({ error: 'All user data fields are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    let user = result.rows[0];
    console.log("NOt present ",user);
    
    if (user) {
      req.session.username = user.username;
      return res.json({ message: 'Login successful', user });
    } else {
        // create new user
      const newUserResult = await pool.query(
        'INSERT INTO users (id, username, first_name, balance, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
        [id, username, first_name, 500]
      );
      const newUser = newUserResult.rows[0];
      //Handle referral logic if referrerID is provided
      console.log(referrerId);
      
      if (referrerId) {
        const referrerResult = await pool.query('SELECT * FROM users WHERE id = $1', [referrerId]);
        const referrer = referrerResult.rows[0];
        console.log('these are the referral details',referrer);
        
        if (referrer) {
            //Create Referral Record
          await pool.query(
            'INSERT INTO referrals (referee_id, referrer_id, reward_given) VALUES ($1, $2, $3)',
            [id, referrerId, true]
          );
          console.log('successful');
          
          //Update referrer Balance
          await pool.query( 'UPDATE users SET balance = balance + 50 WHERE id=$1',[referrerId])
          console.log('Referrer reward added for:', referrerId);
        } else {
          console.log('Invalid referrer ID');
        }
      }

      req.session.username = newUser.username;
      console.log('New user created, session started:', req.session.username);

      return res.json({ message: 'User created successfully', user: newUser });
    }
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/referrals', async (req, res) => {
  const { referrerId } = req.query;

  if (!referrerId) {
    return res.status(400).json({ error: 'Referrer ID is required' });
  }

  try {
    const referredUsersResult = await pool.query(
      'SELECT * FROM users WHERE id IN (SELECT referee_id FROM referrals WHERE referrer_id = $1)',
      [referrerId]
    );

    res.json({ referredUsers: referredUsersResult.rows });
  } catch (err) {
    console.error('Error fetching referred users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/daily-login', async (req, res) => {
    const { userId } = req.body;
    console.log( typeof userId)
    const id = userId;
    console.log(id);
    
    if (!id) {
        return res.status(400).json({ error: "User ID is required" });
    }

    try {
        // Fetch user's login details
        const result = await pool.query('SELECT last_login, login_streak, streak_reward, balance FROM users WHERE id = $1', [id]);
        console.log(result.rows.length)
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        
        const user = result.rows[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);  // Normalize today to midnight for comparison
        
        const lastLogin = user.last_login ? new Date(user.last_login) : null;
        if (lastLogin) lastLogin.setHours(0, 0, 0, 0); // Normalize last login to midnight for comparison

        // Check if the user already logged in today
        if (lastLogin && lastLogin.getTime() === today.getTime()) {
            return res.status(200).json({ message: "Already logged in today, come back tomorrow for the next reward." });
        }
        
        // Check if the login is consecutive (yesterday) or resets the streak
        const isConsecutiveLogin = lastLogin && (today - lastLogin) / (1000 * 60 * 60 * 24) === 1;
        const newLoginStreak = isConsecutiveLogin ? user.login_streak + 1 : 1;

        // Adjust streak reward based on login streak
        let newStreakReward;
        if (newLoginStreak <= 7) {
            newStreakReward = newLoginStreak * 50;
        } else {
            newStreakReward = 250;
        }

        const newBalance = user.balance + newStreakReward;

        // Update user data in the database
        await pool.query(
            "UPDATE users SET balance = $1, last_login = $2, login_streak = $3, streak_reward = $4 WHERE id = $5",
            [newBalance, today, newLoginStreak, newStreakReward, id]
        );

        res.status(200).json({
            message: `Daily login successful! You earned ${newStreakReward} points.`,
            newBalance,
            loginStreak: newLoginStreak,
            streakReward: newStreakReward,
        });
    } catch (error) {
        console.error('Error in daily login:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/check-session', (req, res) => {
    console.log('Session on check:', req.session);
    if (req.session.username) {
        console.log(req.session.username)
        res.json({ isLoggedIn: true, username: req.session.username });//user is authenticated
    } else {
        res.status(401).json({ isLoggedIn: false });
    }
});

// Get User Balance Endpoint
app.get('/get-balance/:username', async (req, res) => {
    const { username } = req.params;

    try {
        const result = await pool.query('SELECT balance,taplimit,refill_count,boostcount FROM users WHERE username = $1', [username]);

        if (result.rows.length > 0) {
            // User found, return balance
            res.status(200).json({ balance: result.rows[0].balance , tapLimit: result.rows[0].taplimit, refillCount: result.rows[0].refill_count, boostCount: result.rows[0].boostcount});
            console.log(result.rows[0].refill_count);
            
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error fetching balance:', error);
        // Send a server error response in case of a database failure
        res.status(500).json({ message: 'Error fetching balance' });
    }
});

// Scheduled task to reset tapLimit to 100 every 24 hours
cron.schedule('0 12 * * *', async () => {
    try {
        // Execute the query to reset the tapLimit
        const result = await pool.query('UPDATE users SET taplimit = 100');
        console.log(`TapLimit reset to 100 for all users. Rows affected: ${result.rowCount}`);
    } catch (error) {
        console.error('Error resetting tapLimit:', error);
    }
});

app.post('/update', async (req, res) => {
    const { username, balance, tapLimit } = req.body; // Extract data from the request body

    // Validate the input
    if (!username || balance === undefined || tapLimit === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Execute the query to update the user's data
        const result = await pool.query(
            'UPDATE users SET balance = $1, taplimit = $2 WHERE username = $3',
            [balance, tapLimit, username]
        );

        if (result.rowCount > 0) {
            // If a row was updated, send a success response
            return res.status(200).json({ message: 'Update successful' });
        } else {
            // If no rows were updated, the username might not exist
            return res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        // Handle any database or server errors
        console.error('Error updating data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

cron.schedule('0 12 * * *', async () => {
    try {
        // Execute the query to reset the tapLimit
        const result = await pool.query('UPDATE users SET refill_count =3');
        console.log(`Refill reset to 3 for all users. Rows affected: ${result.rowCount}`);
    } catch (error) {
        console.error('Error resetting refill:', error);
    }
});

app.post('/refill', async (req, res) => {
  const { username, tapLimit, refillCount } = req.body;

  // Validate the input
  if (!username || tapLimit === undefined || refillCount === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    // Update the user's tapLimit and refillCount in the database
    const result = await pool.query(
      'UPDATE users SET taplimit = $1, refill_count = $2 WHERE username = $3',
      [tapLimit, refillCount, username]
    );

    if (result.rowCount > 0) {
      // If the update was successful, respond with success
      return res.status(200).json({ message: 'Refill successful' });
    } else {
      // If no rows were updated, the username might not exist
      return res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    // Handle any database or server errors
    console.error('Error updating refill:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
cron.schedule('0 12 * * *', async () => {
    try {
        // Execute the query to reset the tapLimit
        const result = await pool.query('UPDATE users SET boostcount =3');
        console.log(`boost reset to 3 for all users. Rows affected: ${result.rowCount}`);
    } catch (error) {
        console.error('Error resetting boost:', error);
    }
});

app.post('/boost', async (req, res) => {
  const { username, boostCount } = req.body;
  console.log('boostcount is:', boostCount);
  
  // Validate the input
  if (!username || boostCount === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Update the user's boostCount and tapLimit in the database
    const result = await pool.query(
      'UPDATE users SET boostcount = $1 WHERE username = $2',
      [boostCount, username]
    );

    if (result.rowCount > 0) {
      // If the update was successful, respond with success
      return res.status(200).json({ message: 'Boost successful' });
    } else {
      // If no rows were updated, the username might not exist
      return res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    // Handle any database or server errors
    console.error('Error updating boost:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/tasks', async (req, res) => {
    const { userId } = req.query; // ensure userId is passed as query parameter
    const id = userId;
    console.log(id);
    
    try {
        // Get tasks for 'essential' type that the user has not completed
        const essentialTasks = await pool.query(
            `SELECT * FROM tasks 
            WHERE type = $1 
            AND NOT EXISTS (SELECT 1 FROM user_tasks WHERE user_id = $2 AND task_id = tasks.id AND completed = TRUE)`,
            ['essential', id]
        );
        console.log(essentialTasks);
        // Get tasks for 'academy' type that the user has not completed
        const academyTasks = await pool.query(
            `SELECT * FROM tasks 
            WHERE type = $1 
            AND NOT EXISTS (SELECT * FROM user_tasks WHERE user_id = $2 AND task_id = tasks.id AND completed = TRUE)`,
            ['academy', id]
        );
        
        // Return tasks grouped by type
        res.json({
            essentialTasks: essentialTasks.rows,
            academyTasks: academyTasks.rows
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});
app.post('/api/tasks/essential/complete',async(req,res)=>{
    const {userId,taskId}=req.body;
    console.log(userId, taskId);
    console.log('i got the userid and the taskid');
    
    try {
        const task=await pool.query('SELECT * FROM tasks WHERE id=$1',[taskId])

        if(task.rows.length===0){
            return res.status(404).json({error: 'Task not found'});
        }

        const taskData=task.rows[0];
        const taskType=taskData.type;
        const reward=taskData.reward || 100; // default reward for essential tasks

        const completionCheck=await pool.query('SELECT * FROM user_tasks WHERE user_id=$1 AND task_id=$2',[userId,taskId]);
        if(completionCheck.rows.length > 0){
            return res.status(400).json({error: 'Task already completed'
            })
        }
        const client=await pool.connect();

        try {
            console.log('we de ere');
            
            await client.query('BEGIN');
            await client.query('INSERT INTO user_tasks (user_id,task_id,completed) VALUES($1,$2,TRUE)',[userId,taskId]);
            console.log(' i am here');
            
            const updatedBalance=await client.query('UPDATE users SET balance= balance + $1 WHERE id=$2 RETURNING balance',[reward,userId])
            if(updatedBalance.rows.length === 0){
                throw new Error('user not found');
            }
            await client.query('COMMIT');
            res.json({
                message: 'Essential task completed successfully',
                newBalance: updatedBalance.rows[0].balance,
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Transactiion failed:',error)
            res.status(500).json({error: 'Failed to complete tasks fully'})
        } finally{
            client.release();
        }
    } catch (error) {
        console.error('error completing task:',error);
        res.status(500).json({error: 'Failed to complete task'})
    }
})

app.post('/api/tasks/complete', async (req, res) => {
    const { userId, taskId, codeInput } = req.body;
    console.log(userId);
    console.log(taskId);
    console.log(codeInput);
    
    try {
        // Fetch task details by taskId
        const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);

        if (task.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const taskData = task.rows[0];
        const taskType = taskData.type;
        const reward = taskData.reward || 100;  // Default reward if not set in task (100 as default)

        // Check if the user has already completed this task
        const completionCheck = await pool.query('SELECT * FROM user_tasks WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
        console.log(completionCheck.rows.length);
        
        if (completionCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Task already completed' });
        }

        // If it's an academy task, validate the code
        if (taskType === 'academy' && taskData.code !== codeInput) {
            return res.status(400).json({ error: 'Incorrect code' });
        }

        // Start a transaction to ensure atomicity
        const client = await pool.connect();  // Get a client from the pool for the transaction
        try {
            await client.query('BEGIN');  // Start the transaction

            // Insert record into user_tasks to mark the task as completed
            await client.query('INSERT INTO user_tasks (user_id, task_id, completed) VALUES ($1, $2, TRUE)', [userId, taskId]);

            // Update the user's balance with the reward
            const updatedBalance = await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [reward, userId]);
            console.log(updatedBalance);
            if(updatedBalance.rows.length ===0){
                console.error(`No rows returned from the update query-user may not exist`);
                return res.status(404).json({error:`User not found`})
            }
            console.log(updatedBalance.rows[0].balance);
            
            // Commit the 
            await client.query('COMMIT');

            // Respond with a success message and the updated balance
            res.json({
                message: 'Task completed successfully',
                newBalance: updatedBalance.rows[0].balance //this is where the error starts from in the backend
            });
            console.log(updatedBalance.rows[0].balance);
            
        } catch (error) {
            await client.query('ROLLBACK');  // Rollback in case of error
            console.error('Transaction failed:', error);
            res.status(500).json({ error: 'Failed to do complete task' });
        } finally {
            client.release();  // Always release the client back
        }
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({ error: 'Failed complete task' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '/dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

