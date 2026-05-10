**Fully funtional NGINX proxy made by Hacker114**

---

**Setup instructions for a VM**

  Run the following commands

   - sudo apt update
   - sudo apt install nginx -y
   - sudo rm -f /etc/nginx/sites-enabled/default
   - sudo cp proxy.conf          /etc/nginx/conf.d/proxy.conf
   - sudo cp sw.js               /usr/share/nginx/html/sw.js
   - sudo cp proxy-bootstrap.js  /usr/share/nginx/html/proxy-bootstrap.js
   - sudo cp 404.html            /usr/share/nginx/html/404.html
   - sudo cp proxy-error.html    /usr/share/nginx/html/proxy-error.html
   - sudo cp index.html  /usr/share/nginx/html/index.html
   - sudo service nginx restart

  Manually forward port 80 on the ports tab.
