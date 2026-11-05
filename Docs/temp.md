Run flow
Wallet: on Confirm & run, the dialog switches to three checks. The first checks your wallet. It goes green if you have enough credits, or red with an error icon and a message if not.
Agent server: the second pings /health on the server side, with a 120s countdown. If the agent never answers, it shows the error icon and “Agent server is not reachable.”
Hold: the third step holds the payment. It carries the note that nothing is deducted on a failed or wrong output.
Sheet: once all three pass, a sheet opens from the right with the agent name at the top and the input form built from the agent’s input schema. You fill it in and press Send. Cancelling releases the hold, and a hold with no input sent is released after 15 minutes.
Worker: the worker signs the request to the agent and streams its events live into the sheet, with a timer. It pings /health every 30 seconds while the run is going.
Output check: if the agent’s output matches its schema, you are charged. Any error or schema violation releases the hold and charges nothing.
Toasts: a toast appears when the agent starts running, and another when the run completes. The completion toast shows the credits deducted and your new balance.
Header: the wallet badge swaps to a lock icon while credits are held, and shows the held amount.

The sheet reads everything from Convex, and its open run id lives in the URL. A refresh brings the same sheet back with all events and the timer. If the network drops, it shows an offline banner and catches up when you reconnect.



"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5000