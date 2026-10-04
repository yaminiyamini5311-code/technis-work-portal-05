class User {

    constructor(data) {

        this.id = data.id;
        this.name = data.name;
        this.email = data.email;
        this.role = data.role;
        this.department = data.department;

    }

}

module.exports = User;