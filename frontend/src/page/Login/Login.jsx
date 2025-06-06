import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";

function Login() {
  const [inputs, setInputs] = useState({ username: "", password: "" });
  const [authUser, setAuthUser] = useState(null); // Keeping authUser
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate(); // Fix: Correctly initialize navigate

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!inputs.username || !inputs.password) {
      setError("Please enter both username and password");
      setIsLoading(false);
      return;
    }

    try {
      const res = await axios.post(
        "http://localhost:5000/api/auth/login",
        { username: inputs.username, password: inputs.password },
        { withCredentials: true }
      );

      const data = res.data;

      if (data.error) {
        setError(data.error);
      } 
        localStorage.setItem("Together-user", JSON.stringify(data));
       setAuthUser(data); // Keeping authUser
       Promise.all;
        navigate("/"); // Fix: Correctly using navigate
      
    } catch (err) {
      console.error("Login error:", err);
      setError("Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="w-full max-w-md p-6 rounded-lg shadow-md bg-blue-950 bg-opacity-70 backdrop-blur-lg m-2">
        <h1 className="text-3xl font-semibold text-center text-white mb-4">
          <span className="text-gray-300">Together</span>
        </h1>
        <form onSubmit={handleSubmit} className="flex flex-col ml-7">
          <div className="mb-4">
            <label className="block text-white mb-2">Username</label>
            <input
              type="text"
              className="w-full input input-bordered h-10 bg-blue-300 border border-white text-white p-2 rounded-md"
              placeholder="Enter Username"
              value={inputs.username}
              onChange={(e) => setInputs({ ...inputs, username: e.target.value })}
            />
          </div>
          <div className="mb-4">
            <label className="block text-white mb-2">Password</label>
            <input
              type="password"
              className="w-full input input-bordered h-10 bg-blue-300 border border-white text-white p-2 rounded-md"
              placeholder="Enter Password"
              value={inputs.password}
              onChange={(e) => setInputs({ ...inputs, password: e.target.value })}
            />
          </div>
          <Link to="/signup" className="text-sm hover:underline hover:text-gray-300 mb-4 text-center">
            {"Don't"} have an account?
          </Link>
          <button className="btn btn-block btn-sm bg-white text-black hover:opacity-80" disabled={isLoading}>
            {isLoading ? <span className="loading loading-spinner-small"></span> : "Login"}
          </button>
          {error && <p className="text-red-500 text-center mt-4">{error}</p>}
        </form>
      </div>
    </div>
  );
}

export default Login;
