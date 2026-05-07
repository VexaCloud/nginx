**Fully funtional NGINX proxy made by Hacker114**

---

**Setup instructions for a VM**

  Run the following commands

   - sudo apt update
   - sudo apt install nginx -y
   - sudo rm -f /etc/nginx/sites-enabled/default
   - sudo nano /etc/nginx/conf.d/proxy.conf (Use config.txt for this file)
   - sudo rm -f /usr/share/nginx/html/index.html
   - sudo nano /usr/share/nginx/html/index.html (Use index.txt for this file)
   - sudo service nginx start

  Manually forward port 80 on the ports tab.
